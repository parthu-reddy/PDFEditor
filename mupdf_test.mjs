import * as mupdf from "mupdf";
import fs from "fs";

async function testRedact() {
  const fileBytes = fs.readFileSync("test.pdf");
  
  // mupdf.Document.open is synchronous?
  // Let's check how to use mupdf
  try {
    const doc = mupdf.Document.openDocument(fileBytes, "application/pdf");
    console.log("Pages:", doc.countPages());
    
    // Test redaction
    const page = doc.loadPage(0);
    // Draw a redaction annotation
    // Let's see the API of page
    console.log(Object.keys(page.__proto__));
  } catch (err) {
    console.error(err);
  }
}
testRedact();
