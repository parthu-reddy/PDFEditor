import { PDFDocument, PDFPage, PDFRawStream, decodePDFRawStream, PDFFont, PDFName, PDFNumber } from 'pdf-lib';
import { TexLinebreak, MIN_COST } from 'tex-linebreak2';

// -----------------------------------------------------------------------------
// MODULE 1: High-Performance Typographic Measurement Engine
// Bypasses heavy OpenType shaping for raw metric calculations.
// -----------------------------------------------------------------------------
export class TypographicEngine {
    private pdfDoc: PDFDocument;
    
    constructor(pdfDoc: PDFDocument) {
        this.pdfDoc = pdfDoc;
    }

    /**
     * Extracts precise pixel widths using raw advanceWidth parameters.
     * Prevents extreme computational overhead during mass word measurement.
     */
    public static measureStringWidth(text: string, font: any, fontSize: number): number {
        // Access underlying fontkit implementation details safely
        const fkFont = font.embedder?.font || font.font;
        
        if (!fkFont || !fkFont.glyphsForString) {
            return font.widthOfTextAtSize(text, fontSize); // Fallback
        }

        const advanceWidth = fkFont.glyphsForString(text).reduce((acc: number, glyph: any) => {
            return acc + (glyph.advanceWidth || 0);
        }, 0);

        return (advanceWidth / fkFont.unitsPerEm) * fontSize;
    }
}

// -----------------------------------------------------------------------------
// MODULE 2: Knuth-Plass Text Layout & Wrapping Engine
// Solves 'Step 2' - Identifying line breaks in a bounding box.
// -----------------------------------------------------------------------------
export interface LayoutLine {
    text: string;
    width: number;
    yOffset: number;
}

export class AdvancedTextLayout {
    /**
     * Executes the TeX dynamic programming algorithm to calculate aesthetically 
     * perfect line breaks, avoiding the pitfalls of greedy algorithms.
     */
    public static calculateOptimalLayout(
        text: string, 
        font: PDFFont, 
        fontSize: number, 
        maxWidth: number,
        lineHeight: number
    ): LayoutLine[] {
        const tokens = text.split(/(\s+)/);
        const items: any[] = [];
        const spaceWidth = TypographicEngine.measureStringWidth(' ', font, fontSize);

        // Convert tokens to TeX primitives (Boxes, Glue, Penalties)
        tokens.forEach(token => {
            if (/^\s+$/.test(token)) {
                items.push({
                    type: 'glue',
                    width: spaceWidth,
                    stretch: spaceWidth * 0.5, // Allow 50% expansion
                    shrink: spaceWidth * 0.33  // Allow 33% compression
                });
            } else if (token.length > 0) {
                const wordWidth = TypographicEngine.measureStringWidth(token, font, fontSize);
                items.push({ type: 'box', width: wordWidth, text: token });
            }
        });

        // Terminating penalty forces the DAG to finalize the path
        items.push({ type: 'penalty', width: 0, cost: MIN_COST, flagged: 1 });

        // Execute algorithm
        const linebreak = new TexLinebreak(items, { lineWidth: maxWidth });
        const layoutLines: LayoutLine[] = [];
        let currentYOffset = 0;

        linebreak.lines.forEach((lineObj: any) => {
            let lineStr = '';
            lineObj.positionedItems.forEach((pItem: any) => {
                if (pItem.type === 'box') {
                    lineStr += pItem.text;
                } else if (pItem.type === 'glue') {
                    lineStr += ' ';
                }
            });

            lineStr = lineStr.trim();
            if (lineStr.length > 0) {
                layoutLines.push({
                    text: lineStr,
                    width: TypographicEngine.measureStringWidth(lineStr, font, fontSize),
                    yOffset: currentYOffset
                });
                // Accumulate leading (moves baseline down in User Space)
                currentYOffset -= lineHeight;
            }
        });

        return layoutLines;
    }
}

// -----------------------------------------------------------------------------
// MODULE 3: Binary AST Parser & Geometric Shift Coordinator
// Solves 'Step 3' - Shifting subsequent content streams down the page.
// -----------------------------------------------------------------------------
export class ContentStreamCoordinator {
    /**
     * Parses the AST, intercepts text matrices, evaluates absolute Y coordinates,
     * and injects the delta shift to structurally push text down.
     */
    public static async pushContentDown(
        page: PDFPage, 
        originY: number, 
        deltaY: number
    ): Promise<void> {
        const anyPage = page as any;
        if (!anyPage.node || !anyPage.node.Contents) return;

        const contents = anyPage.node.Contents();
        if (!contents) return;

        // Contents can be a single stream or an array of streams
        const streamsToProcess = anyPage.doc.context.lookup(contents);
        const streams = [];

        // pdf-lib's PDFArray or PDFRawStream checking
        if (streamsToProcess.constructor.name === 'PDFArray') {
            for (let i = 0; i < streamsToProcess.size(); i++) {
                streams.push({
                    ref: contents.get(i),
                    stream: anyPage.doc.context.lookup(contents.get(i))
                });
            }
        } else {
            streams.push({
                ref: contents,
                stream: streamsToProcess
            });
        }

        for (const { ref, stream } of streams) {
            if (stream && stream instanceof PDFRawStream) {
                const decoded = decodePDFRawStream(stream).decode();
                let str = Array.from(decoded).map(b => String.fromCharCode(b)).join('');

                let currentAbsoluteY = 0;

                // Regex matches Tm, Td, and TD operators
                const operatorRegex = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm|([-\d.]+)\s+([-\d.]+)\s+(Td|TD)/g;

                let modifiedStr = str.replace(operatorRegex, (match, ...args) => {
                    if (match.endsWith('Tm')) {
                        const a = args[0], b = args[1], c = args[2], d = args[3], tx = args[4], ty = args[5];
                        let y = parseFloat(ty);
                        currentAbsoluteY = y;
                        if (currentAbsoluteY < originY) {
                            y -= deltaY;
                        }
                        return `${a} ${b} ${c} ${d} ${tx} ${Number.isInteger(y) ? y : y.toFixed(2)} Tm`;
                    } 
                    else {
                        const tx = args[6], ty = args[7], op = args[8];
                        let y = parseFloat(ty);
                        let previousY = currentAbsoluteY;
                        currentAbsoluteY += y;
                        if (currentAbsoluteY < originY && previousY >= originY) {
                            y -= deltaY;
                        }
                        return `${tx} ${Number.isInteger(y) ? y : y.toFixed(2)} ${op}`;
                    }
                });

                // Mutate stream in-place
                const encoded = new Uint8Array(modifiedStr.length);
                for (let i = 0; i < modifiedStr.length; i++) {
                    encoded[i] = modifiedStr.charCodeAt(i);
                }
                stream.contents = encoded;
                if (stream.dict.has(PDFName.of('Filter'))) {
                    stream.dict.delete(PDFName.of('Filter'));
                }
                stream.dict.set(PDFName.of('Length'), PDFNumber.of(encoded.length));
            }
        }
    }
}
