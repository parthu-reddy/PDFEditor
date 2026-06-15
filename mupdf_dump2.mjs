import * as mupdf from "mupdf";
import fs from "fs";

async function dumpApi() {
  console.log("PDFDocument keys:", Object.getOwnPropertyNames(mupdf.PDFDocument.prototype));
  console.log("PDFPage keys:", Object.getOwnPropertyNames(mupdf.PDFPage.prototype));
  console.log("PDFAnnotation keys:", Object.getOwnPropertyNames(mupdf.PDFAnnotation.prototype));
}
dumpApi();
