import * as mupdf from "mupdf";
import fs from "fs";

async function testRedactionRect() {
  const bytes = fs.readFileSync("test.pdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(0);
  
  const bounds = page.getBounds();
  console.log("Bounds:", bounds); // [0, 0, 595, 842]
  const width = bounds[2] - bounds[0];
  const height = bounds[3] - bounds[1];
  
  // Create a Redact annot
  const annot = page.createAnnotation("Redact");
  // Let's redact the top-left corner
  // If origin is top-left, this will redact the top-left of the page.
  // If origin is bottom-left, this will redact the bottom-left of the page.
  annot.setRect([0, 0, 100, 100]); 
  
  // Redact another one at top-right
  const annot2 = page.createAnnotation("Redact");
  annot2.setRect([width - 100, 0, width, 100]);
  
  page.applyRedactions(false);
  
  const outBytes = doc.saveToBuffer("incremental");
  fs.writeFileSync("redacted2.pdf", outBytes.asUint8Array());
  console.log("Saved redacted2.pdf");
}
testRedactionRect();
