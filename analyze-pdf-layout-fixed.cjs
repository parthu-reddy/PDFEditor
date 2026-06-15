const pdfjs = require('pdfjs-dist');
const fs = require('fs');
const path = require('path');

async function analyzeLayout(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  
  console.log(`\n=== Analyzing ${path.basename(pdfPath)} ===`);
  
  let currentY = null;
  let lineStr = "";
  let yCoords = [];

  for (const item of textContent.items) {
    // Math.round to group roughly the same line
    const y = Math.round(item.transform[5]); 
    if (currentY !== null && Math.abs(currentY - y) > 5) {
      console.log(`Y: ${currentY} -> ${lineStr.substring(0, 80)}...`);
      yCoords.push({ y: currentY, text: lineStr });
      lineStr = "";
    }
    lineStr += item.str;
    currentY = y;
  }
  if (lineStr) {
    console.log(`Y: ${currentY} -> ${lineStr.substring(0, 80)}...`);
    yCoords.push({ y: currentY, text: lineStr });
  }

  // Check for overlaps (distance < 10)
  for (let i = 0; i < yCoords.length - 1; i++) {
    const diff = Math.abs(yCoords[i].y - yCoords[i+1].y);
    if (diff < 8 && diff > 0) {
      console.log(`⚠️ POTENTIAL OVERLAP DETECTED! Y=${yCoords[i].y} and Y=${yCoords[i+1].y}`);
    }
  }
}

async function run() {
  await analyzeLayout(path.join(__dirname, 'demo-contract.pdf'));
  await analyzeLayout(path.join(__dirname, 'demo-contract-edited.pdf'));
}

run();
