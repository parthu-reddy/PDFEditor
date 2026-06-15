import * as pdfjs from 'pdfjs-dist';

/**
 * A single text block extracted from a PDF page.
 * All position values (x, y, width, height) are normalized to [0, 1]
 * relative to the rendered canvas dimensions at the given rotation.
 */
export interface PdfTextBlock {
  id: string;
  pageIndex: number;   // 0-based
  text: string;
  // Normalized (0–1) visual position on the rendered canvas
  x: number;
  y: number;
  width: number;
  height: number;
  // Original font size in PDF points (approximate)
  fontSize: number;
  fontName: string;
}

/**
 * Extracts all visible text blocks from a single PDF page.
 *
 * @param pdfDocument  The loaded pdfjs PDFDocumentProxy
 * @param pageIndex    0-based page index
 * @param rotation     Final rendered rotation in degrees (originalRotation + rotationOffset)
 * @returns            Array of PdfTextBlock with normalized visual coords
 */
export async function extractPageTextBlocks(
  pdfDocument: pdfjs.PDFDocumentProxy,
  pageIndex: number,
  rotation: number
): Promise<PdfTextBlock[]> {
  const page = await pdfDocument.getPage(pageIndex + 1);

  // Get the viewport at scale=1 with the final rotation so we know the
  // canvas dimensions and the transform that maps PDF space → screen space.
  const viewport = page.getViewport({ scale: 1, rotation });
  const canvasWidth = viewport.width;
  const canvasHeight = viewport.height;

  const textContent = await page.getTextContent();

  const blocks: PdfTextBlock[] = [];

  for (const item of textContent.items) {
    // pdfjs TextItem has a `str` field; TextMarkedContent does not
    if (!('str' in item)) continue;
    const textItem = item as any;

    const str = textItem.str.trim();
    if (!str) continue;

    // `transform` is a 6-element affine matrix [a,b,c,d,e,f]
    // where [e, f] is the origin (PDF user space, bottom-left origin).
    const [, , , scaleY, pdfX, pdfY] = textItem.transform;

    // Map PDF user-space coords → canvas pixel coords via the viewport transform.
    // viewport.convertToViewportPoint maps [PDF x, PDF y] → [canvas px, canvas py].
    const [canvasX, canvasY] = viewport.convertToViewportPoint(pdfX, pdfY);

    // Font size: |scaleY| in PDF user space approximates the rendered em height.
    // We scale it by the viewport scale (1 here) for canvas pixels.
    const fontSizePx = Math.abs(scaleY);

    // Width: pdfjs provides `width` in user space units; scale to canvas pixels.
    const widthPx = textItem.width * (canvasWidth / viewport.width);
    // Height: use font size as a proxy for line height
    const heightPx = fontSizePx * 1.2;

    // Normalize to [0, 1]
    const normX = canvasX / canvasWidth;
    // canvasY is measured from the top in viewport space
    const normY = (canvasY - fontSizePx) / canvasHeight; // subtract font height (origin is baseline)
    const normW = widthPx / canvasWidth;
    const normH = heightPx / canvasHeight;

    // Skip items that land outside the page (e.g., headers in media box)
    if (normX < -0.01 || normY < -0.01 || normX > 1.01 || normY > 1.01) continue;

    blocks.push({
      id: `tb-${pageIndex}-${crypto.randomUUID()}`,
      pageIndex,
      text: textItem.str,
      x: Math.max(0, normX),
      y: Math.max(0, normY),
      width: Math.min(normW, 1 - normX),
      height: Math.min(normH, 1 - normY),
      fontSize: fontSizePx,
      fontName: textItem.fontName || 'Helvetica',
    });
  }

  // Sort blocks top-to-bottom, left-to-right
  blocks.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 0.005) return a.y - b.y;
    return a.x - b.x;
  });

  const groupedBlocks: PdfTextBlock[] = [];
  let currentGroup: PdfTextBlock | null = null;

  for (const block of blocks) {
    if (!currentGroup) {
      currentGroup = { ...block };
      groupedBlocks.push(currentGroup);
      continue;
    }

    const yDiffPx = (block.y - currentGroup.y) * canvasHeight;
    // Ensure it's below, but not too far below (e.g. 2.5x font size max for double spacing)
    const isNextLine = yDiffPx > 0 && yDiffPx <= currentGroup.fontSize * 2.5;
    const isSameFont = block.fontName === currentGroup.fontName;
    const isSameSize = Math.abs(block.fontSize - currentGroup.fontSize) < 2;
    // Ensure it's not wildly offset to the right/left (e.g. part of a different column)
    const xDiffPx = Math.abs((block.x - currentGroup.x) * canvasWidth);
    const isAligned = xDiffPx < canvasWidth * 0.5;

    if (isNextLine && isSameFont && isSameSize && isAligned) {
      // Merge into currentGroup
      currentGroup.text += ' ' + block.text;
      
      // Expand bounding box
      const minX = Math.min(currentGroup.x, block.x);
      const maxX = Math.max(currentGroup.x + currentGroup.width, block.x + block.width);
      const minY = Math.min(currentGroup.y, block.y);
      const maxY = Math.max(currentGroup.y + currentGroup.height, block.y + block.height);

      currentGroup.x = minX;
      currentGroup.y = minY;
      currentGroup.width = maxX - minX;
      currentGroup.height = maxY - minY;
    } else {
      currentGroup = { ...block };
      groupedBlocks.push(currentGroup);
    }
  }

  return groupedBlocks;
}
