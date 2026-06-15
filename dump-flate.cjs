const pdfLib = require('pdf-lib');
const { PDFDocument } = pdfLib;
async function test() {
  const doc = await PDFDocument.create();
  console.log(doc.context.flateStream.toString());
}
test();
