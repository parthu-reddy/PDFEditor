import * as mupdf from "mupdf";
import fs from "fs";

async function dumpApi() {
  console.log("mupdf keys:", Object.keys(mupdf));
  console.log("Document keys:", Object.getOwnPropertyNames(mupdf.Document.prototype));
  console.log("Page keys:", Object.getOwnPropertyNames(mupdf.Page.prototype));
}
dumpApi();
