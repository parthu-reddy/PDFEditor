import * as mupdf from "mupdf";
import { PDFDocument } from "pdf-lib";
import fs from "fs";

async function checkBounds() {
  const bytes = fs.readFileSync("test.pdf");
  const mdoc = mupdf.Document.openDocument(bytes, "application/pdf");
  const mpage = mdoc.loadPage(0);
  console.log("MuPDF bounds:", mpage.getBounds());
  
  const pdoc = await PDFDocument.load(bytes);
  const ppage = pdoc.getPage(0);
  console.log("PDF-lib bounds:", ppage.getWidth(), ppage.getHeight());
}
checkBounds();
