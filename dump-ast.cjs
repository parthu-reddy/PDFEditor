const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
async function dump() {
  const bytes = fs.readFileSync('demo-contract.pdf');
  const pdfDoc = await PDFDocument.load(bytes);
  const anyPage = pdfDoc.getPages()[0];
  console.log('Methods on anyPage:', Object.getOwnPropertyNames(Object.getPrototypeOf(anyPage)));
  console.log('Methods on anyPage.node:', Object.getOwnPropertyNames(Object.getPrototypeOf(anyPage.node)));
}
dump();
