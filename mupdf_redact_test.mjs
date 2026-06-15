import * as mupdf from "mupdf";
import fs from "fs";

async function testRedaction() {
  const fileBytes = fs.readFileSync("test.pdf");
  const doc = mupdf.Document.openDocument(fileBytes, "application/pdf");
  
  const page = doc.loadPage(0);
  
  const annot = page.createAnnotation("Redact");
  annot.setRect([0, 0, 500, 500]); 
  page.applyRedactions(false);
  
  const outBytes = doc.saveToBuffer("incremental");
  fs.writeFileSync("redacted.pdf", outBytes.asUint8Array());
  console.log("Redacted PDF saved");
}
testRedaction();
