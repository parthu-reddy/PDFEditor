const pdfLib = require('pdf-lib');
const fs = require('fs');

async function test() {
  const bytes = fs.readFileSync('demo-contract.pdf');
  const pdfDoc = await pdfLib.PDFDocument.load(bytes);
  
  const encoded = new Uint8Array([65, 66, 67]);
  const newStream = pdfDoc.context.flateStream(encoded);
  console.log("Size:", newStream.sizeInBytes());
}
test();
