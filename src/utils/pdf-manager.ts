import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import * as mupdf from 'mupdf';
import * as pdfjs from 'pdfjs-dist';
import fontkit from '@pdf-lib/fontkit';
import { mapVisualBoundsToPdfDrawing, mapVisualPointToPdfPoint } from './coordinate-mapper';
import { AdvancedTextLayout, ContentStreamCoordinator } from './layout-engine';

// Set worker source for PDF.js (configured in Vite config as well)
// In a React Vite app, we can resolve the worker from the node_modules folder or use a CDN
// We will configure a local worker so it runs fully offline.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface PageState {
  id: string;              // Unique ID for keys / list rendering
  originalPageIndex: number; // 0-indexed page index in the source PDF (-1 for blank pages)
  rotationOffset: number;   // User rotation offset: 0, 90, 180, 270
  originalRotation: number; // Rotation as defined in the source PDF (usually 0, 90, 180, 270)
  width: number;            // Page width in PDF points
  height: number;           // Page height in PDF points
}

export interface Annotation {
  id: string;
  pageId: string; // ID of the PageState page
  type: 'text' | 'draw' | 'shape' | 'image' | 'signature' | 'text-edit';
  x: number;      // 0 to 1 relative visual X
  y: number;      // 0 to 1 relative visual Y
  width: number;  // 0 to 1 relative visual width
  height: number; // 0 to 1 relative visual height
  color: string;  // Hex color code (e.g. #ff0000)
  opacity?: number; // 0 to 1
  
  // Type specific properties
  text?: string;
  fontSize?: number;
  
  points?: { x: number; y: number }[]; // For freehand draw, relative points
  strokeWidth?: number; // For draw or shape
  
  shapeType?: 'rectangle' | 'circle' | 'arrow' | 'line';
  fillColor?: string; // Hex color code
  isFilled?: boolean;
  
  imageSrc?: string; // Base64 data URL

  // text-edit type: inline replacement of existing PDF text
  originalBlockId?: string; // ID of the PdfTextBlock being replaced
  originalText?: string;    // The original text from the PDF
  editedText?: string;      // The user's replacement text
}

/**
 * Converts a hex color string to a pdf-lib RGB color object.
 */
function parseHexToRgb(hex: string) {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(c => c + c).join('');
  }
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

/**
 * Helper to get page dimensions and metadata using PDF.js.
 */
export async function getPdfPagesInfo(fileBytes: Uint8Array): Promise<PageState[]> {
  const loadingTask = pdfjs.getDocument({ data: fileBytes.slice(0) });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const pagesInfo: PageState[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    
    pagesInfo.push({
      id: `page-${crypto.randomUUID()}`,
      originalPageIndex: i - 1,
      rotationOffset: 0,
      originalRotation: page.rotate,
      // page.rotate dictates rotation (0, 90, 180, 270)
      // viewport.width and height are already adjusted for rotation,
      // but we store the standard base dimensions in PDF points
      width: page.rotate % 180 === 0 ? viewport.width : viewport.height,
      height: page.rotate % 180 === 0 ? viewport.height : viewport.width,
    });
  }

  return pagesInfo;
}

/**
 * Compiles a new PDF file by loading the original bytes, reordering/rotating pages,
 * and overlaying all annotations.
 */
export async function compilePdf(
  originalBytes: Uint8Array,
  pagesState: PageState[],
  annotations: Annotation[]
): Promise<Uint8Array> {
  let processedBytes = originalBytes.slice(0);

  // 1. First Pass: Physical Redaction via MuPDF
  const hasRedactions = annotations.some(a => a.type === 'text-edit' && a.editedText !== undefined);
  if (hasRedactions) {
    const doc = mupdf.Document.openDocument(processedBytes, "application/pdf") as mupdf.PDFDocument;
    let appliedAny = false;

    for (const pageState of pagesState) {
      if (pageState.originalPageIndex === -1) continue;

      const pageAnns = annotations.filter(
        a => a.pageId === pageState.id && a.type === 'text-edit' && a.editedText !== undefined
      );

      if (pageAnns.length > 0) {
        const page = doc.loadPage(pageState.originalPageIndex) as mupdf.PDFPage;
        const bounds = page.getBounds();
        const width = bounds[2] - bounds[0];
        const height = bounds[3] - bounds[1];

        for (const ann of pageAnns) {
          // ann.x, ann.y are normalized [0, 1] from top-left.
          // MuPDF uses top-left origin coordinates by default.
          const x0 = bounds[0] + ann.x * width;
          const y0 = bounds[1] + ann.y * height;
          const x1 = x0 + ann.width * width;
          const y1 = y0 + ann.height * height;

          const redactAnn = page.createAnnotation("Redact");
          redactAnn.setRect([x0, y0, x1, y1]);
        }
        
        // false = no black boxes, 2 = image pixel removal, 1 = line art remove, 0 = text remove
        page.applyRedactions(false);
        appliedAny = true;
      }
    }

    if (appliedAny) {
      processedBytes = doc.saveToBuffer("incremental").asUint8Array();
    }
  }

  // 2. Second Pass: Assembly and Drawing via PDF-lib
  const sourcePdfDoc = await PDFDocument.load(processedBytes);
  const outputPdfDoc = await PDFDocument.create();
  outputPdfDoc.registerFontkit(fontkit);

  // 1. Rebuild the page sequence (copy pages or create blank ones)
  const copiedPagesMap = new Map<number, number>(); // Map from old page index to output page index

  for (let newIndex = 0; newIndex < pagesState.length; newIndex++) {
    const pageState = pagesState[newIndex];
    let newPage;

    if (pageState.originalPageIndex === -1) {
      // Create a blank page
      newPage = outputPdfDoc.addPage([pageState.width, pageState.height]);
    } else {
      // Copy existing page from source PDF
      const [copiedPage] = await outputPdfDoc.copyPages(sourcePdfDoc, [pageState.originalPageIndex]);
      newPage = outputPdfDoc.addPage(copiedPage);
      
      // Keep track of where the original page landed
      copiedPagesMap.set(pageState.originalPageIndex, newIndex);
    }

    // Apply the final calculated rotation to the new page
    const finalRotation = (pageState.originalRotation + pageState.rotationOffset) % 360;
    newPage.setRotation(degrees(finalRotation));
  }

  // Load a font for text drawing. We'll embed Helvetica as a fallback.
  // In standard PDF, Helvetica is built-in and doesn't inflate the PDF file size.
  const helveticaFont = await outputPdfDoc.embedFont(StandardFonts.Helvetica);

  // Group annotations by page ID for easier rendering
  const annotationsByPage = new Map<string, Annotation[]>();
  annotations.forEach(ann => {
    const list = annotationsByPage.get(ann.pageId) || [];
    list.push(ann);
    annotationsByPage.set(ann.pageId, list);
  });

  // 2. Draw annotations on each page
  for (let i = 0; i < pagesState.length; i++) {
    const pageState = pagesState[i];
    const pageAnns = annotationsByPage.get(pageState.id) || [];
    if (pageAnns.length === 0) continue;

    const page = outputPdfDoc.getPage(i);
    const pdfWidth = page.getWidth();
    const pdfHeight = page.getHeight();
    const finalRotation = page.getRotation().angle;

    for (const ann of pageAnns) {
      const isText = ann.type === 'text';
      const coords = mapVisualBoundsToPdfDrawing(
        { x: ann.x, y: ann.y, width: ann.width, height: ann.height },
        pdfWidth,
        pdfHeight,
        finalRotation,
        isText
      );

      const color = parseHexToRgb(ann.color);
      const opacity = ann.opacity ?? 1.0;

      if (ann.type === 'text-edit' && ann.editedText !== undefined) {
        // Text is already physically deleted by MuPDF. We just draw the replacement text.
        const fontSize = ann.fontSize || 12;
        const lineHeight = fontSize * 1.35;
        let layoutLines: any[] = [];
        let newTotalHeight = 0;

        if (ann.editedText.trim()) {
          layoutLines = AdvancedTextLayout.calculateOptimalLayout(
            ann.editedText,
            helveticaFont,
            fontSize,
            Math.abs(coords.width),
            lineHeight
          );
          newTotalHeight = layoutLines.length * lineHeight;
        }

        // Calculate delta (can be negative, meaning content should be pulled UP)
        const deltaY = newTotalHeight - Math.abs(coords.height);

        if (deltaY !== 0) {
          // Push content up or down in the local page AST. We need coords.y which is the baseline.
          await ContentStreamCoordinator.pushContentDown(page, coords.y, deltaY);
        }

        if (layoutLines.length > 0) {
          layoutLines.forEach((line) => {
            page.drawText(line.text, {
              x: coords.x,
              // Move down by line.yOffset. Note that line.yOffset is negative in AdvancedTextLayout.
              y: coords.y + Math.abs(coords.height) + line.yOffset - fontSize, 
              size: fontSize,
              font: helveticaFont,
              color: rgb(0, 0, 0),
              opacity: 1,
              rotate: degrees(coords.rotateDegrees),
            });
          });
        }
      } else if (ann.type === 'text' && ann.text) {
        page.drawText(ann.text, {
          x: coords.x,
          y: coords.y,
          size: ann.fontSize || 14,
          font: helveticaFont,
          color: color,
          opacity: opacity,
          rotate: degrees(coords.rotateDegrees),
        });
      } else if (ann.type === 'draw' && ann.points && ann.points.length > 0) {
        // Draw freehand drawing line segments
        const strokeWidth = ann.strokeWidth || 2;
        
        for (let s = 0; s < ann.points.length - 1; s++) {
          const visualPt1 = ann.points[s];
          const visualPt2 = ann.points[s + 1];
          
          const pt1 = mapVisualPointToPdfPoint(visualPt1.x, visualPt1.y, pdfWidth, pdfHeight, finalRotation);
          const pt2 = mapVisualPointToPdfPoint(visualPt2.x, visualPt2.y, pdfWidth, pdfHeight, finalRotation);

          page.drawLine({
            start: pt1,
            end: pt2,
            thickness: strokeWidth,
            color: color,
            opacity: opacity,
          });
        }
      } else if (ann.type === 'shape') {
        const strokeWidth = ann.strokeWidth || 2;
        const isFilled = ann.isFilled || false;
        const fillColor = ann.fillColor ? parseHexToRgb(ann.fillColor) : undefined;

        if (ann.shapeType === 'rectangle') {
          page.drawRectangle({
            x: coords.x,
            y: coords.y,
            width: coords.width,
            height: coords.height,
            borderColor: color,
            borderWidth: strokeWidth,
            borderOpacity: opacity,
            color: isFilled ? fillColor : undefined,
            opacity: isFilled ? opacity : 0,
            rotate: degrees(coords.rotateDegrees),
          });
        } else if (ann.shapeType === 'circle') {
          // pdf-lib drawEllipse uses coordinates for the center of the ellipse
          const xRadius = coords.width / 2;
          const yRadius = coords.height / 2;
          
          // Let's approximate center position
          // In standard unrotated space, bottom-left is x,y.
          // Center is x + width/2, y + height/2.
          let centerX = coords.x + xRadius;
          let centerY = coords.y + yRadius;

          // Adjust center based on rotation
          if (coords.rotateDegrees === 90) {
            // Rotated 90: width/height swapped. Origin shifted.
            centerX = coords.x - yRadius; // Since rotated, vertical goes in -X
            centerY = coords.y + xRadius;
          } else if (coords.rotateDegrees === 180) {
            centerX = coords.x - xRadius;
            centerY = coords.y - yRadius;
          } else if (coords.rotateDegrees === 270) {
            centerX = coords.x + yRadius;
            centerY = coords.y - xRadius;
          }

          page.drawEllipse({
            x: centerX,
            y: centerY,
            xScale: xRadius,
            yScale: yRadius,
            borderColor: color,
            borderWidth: strokeWidth,
            borderOpacity: opacity,
            color: isFilled ? fillColor : undefined,
            opacity: isFilled ? opacity : 0,
            rotate: degrees(coords.rotateDegrees),
          });
        } else if (ann.shapeType === 'line' || ann.shapeType === 'arrow') {
          // Line from top-left visual corner of box to bottom-right visual corner
          // or we can just draw diagonal across bounds.
          const pt1 = mapVisualPointToPdfPoint(ann.x, ann.y, pdfWidth, pdfHeight, finalRotation);
          const pt2 = mapVisualPointToPdfPoint(ann.x + ann.width, ann.y + ann.height, pdfWidth, pdfHeight, finalRotation);

          page.drawLine({
            start: pt1,
            end: pt2,
            thickness: strokeWidth,
            color: color,
            opacity: opacity,
          });

          if (ann.shapeType === 'arrow') {
            // Draw arrowhead at pt2
            const dx = pt2.x - pt1.x;
            const dy = pt2.y - pt1.y;
            const angle = Math.atan2(dy, dx);
            const arrowLength = 12;
            const arrowAngle = Math.PI / 6; // 30 degrees

            const arrowPt1 = {
              x: pt2.x - arrowLength * Math.cos(angle - arrowAngle),
              y: pt2.y - arrowLength * Math.sin(angle - arrowAngle),
            };
            const arrowPt2 = {
              x: pt2.x - arrowLength * Math.cos(angle + arrowAngle),
              y: pt2.y - arrowLength * Math.sin(angle + arrowAngle),
            };

            page.drawLine({
              start: pt2,
              end: arrowPt1,
              thickness: strokeWidth,
              color: color,
              opacity: opacity,
            });

            page.drawLine({
              start: pt2,
              end: arrowPt2,
              thickness: strokeWidth,
              color: color,
              opacity: opacity,
            });
          }
        }
      } else if ((ann.type === 'image' || ann.type === 'signature') && ann.imageSrc) {
        // Parse base64 image data
        const base64Data = ann.imageSrc.split(',')[1] || ann.imageSrc;
        const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        
        let embeddedImage;
        if (ann.imageSrc.includes('image/png')) {
          embeddedImage = await outputPdfDoc.embedPng(imageBytes);
        } else {
          // Default to JPG
          embeddedImage = await outputPdfDoc.embedJpg(imageBytes);
        }

        page.drawImage(embeddedImage, {
          x: coords.x,
          y: coords.y,
          width: coords.width,
          height: coords.height,
          rotate: degrees(coords.rotateDegrees),
        });
      }
    }
  }

  // Save and serialize the document to a byte array
  return await outputPdfDoc.save();
}
