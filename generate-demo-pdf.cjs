const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');

async function createDemoPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Draw Title
  page.drawText("TERMS OF SERVICE AGREEMENT", {
    x: 50,
    y: 730,
    size: 18,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.3)
  });

  const text1 = "1. ACCEPTANCE OF TERMS. By accessing and using our Services, you agree to be bound by these Terms. If you do not agree to these Terms, you must not access or use the Services.";
  
  const text2 = "2. USER OBLIGATIONS. You are responsible for all activities that occur under your account. You agree not to use the Services for any unlawful purpose or in any way that interrupts, damages, or impairs the service. You must maintain the confidentiality of your account credentials.";

  const text3 = "3. LIMITATION OF LIABILITY. To the maximum extent permitted by law, the Company shall not be liable for any indirect, incidental, special, consequential or punitive damages, or any loss of profits or revenues.";

  const drawParagraph = (text, startY) => {
    page.drawText(text, {
      x: 50,
      y: startY,
      size: 12,
      font: font,
      maxWidth: 500,
      lineHeight: 16
    });
  };

  drawParagraph(text1, 680);
  drawParagraph(text2, 620);
  drawParagraph(text3, 530);

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync('demo-contract.pdf', pdfBytes);
  console.log('Created demo-contract.pdf');
}

createDemoPdf();
