const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');

async function createTestPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const text1 = "This is the first paragraph. It is quite long and spans multiple lines so that we can test if the paragraph grouping logic in our text extractor works correctly. If it works, this entire block of text will become a single editable text field when clicked in the user interface.";
  
  const text2 = "This is the second paragraph. It is positioned directly below the first paragraph. When the first paragraph is edited and made shorter, this paragraph should automatically be pulled UP the page to close the gap. If we add text, this paragraph should be pushed DOWN the page.";

  // Draw paragraph 1
  page.drawText(text1, {
    x: 50,
    y: 700,
    size: 12,
    font: font,
    maxWidth: 500,
    lineHeight: 16
  });

  // Draw paragraph 2
  page.drawText(text2, {
    x: 50,
    y: 600, // positioned below paragraph 1
    size: 12,
    font: font,
    maxWidth: 500,
    lineHeight: 16
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync('test-paragraph.pdf', pdfBytes);
  console.log('Created test-paragraph.pdf');
}

createTestPdf();
