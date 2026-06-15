const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function screenshot(page, name) {
  // Use artifacts folder so the agent can easily embed them in markdown
  const artifactsDir = '/Users/parthureddy/.gemini/antigravity-ide/brain/6866db2a-95e0-4e67-9b85-8c86064d8a0e';
  await page.screenshot({ path: path.join(artifactsDir, `${name}.png`) });
  console.log(`Saved screenshot: ${name}.png`);
}

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[Browser ${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    console.log(`[Browser UNCAUGHT EXCEPTION] ${err.message}`);
  });

  await page.setViewportSize({ width: 1200, height: 900 });

  console.log('\n=== Load original PDF ===');
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1000);
  
  const originalPdfPath = path.resolve(__dirname, 'demo-contract.pdf');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open PDF")'),
  ]);
  await fileChooser.setFiles(originalPdfPath);
  
  await page.waitForSelector('.loading-overlay', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForSelector('canvas', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1000);
  await screenshot(page, '01_demo_original');

  console.log('\n=== Switch to Edit Mode ===');
  const editTextBtn = page.getByRole('button', { name: 'Edit Text' });
  await editTextBtn.click();
  await page.waitForTimeout(1000); 

  console.log('\n=== Expand Paragraph 2 ===');
  const textBlocks = page.locator('[contenteditable="true"]');
  const secondBlock = textBlocks.nth(1); // 2nd paragraph
  
  const additionalText = " Furthermore, the Company strictly prohibits the use of automated bots, scrapers, or any other unauthorized data extraction tools. By violating this provision, you agree to immediately forfeit any and all rights to access the platform. We reserve the absolute right to terminate services without prior notice, suspend accounts indefinitely, and pursue all available legal remedies to recover damages incurred by such violations. This clause shall survive any termination of the agreement.";
  
  const originalText = await secondBlock.innerText();
  await secondBlock.click();
  await secondBlock.fill(originalText + additionalText);
  await page.waitForTimeout(1000);
  
  console.log('\n=== Export PDF ===');
  await page.mouse.click(10, 10); // blur
  await page.waitForTimeout(1000);
  
  const downloadBtn = page.getByTitle('Download').or(page.getByRole('button', { name: /Download/i })).first();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadBtn.click()
  ]);
  
  const editedPdfPath = path.join(__dirname, 'demo-contract-edited.pdf');
  await download.saveAs(editedPdfPath);
  console.log(`✅ Saved edited PDF to ${editedPdfPath}`);

  console.log('\n=== Load EDITED PDF ===');
  await page.reload();
  await page.waitForTimeout(1000);
  
  const [fileChooser2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open PDF")'),
  ]);
  await fileChooser2.setFiles(editedPdfPath);
  
  await page.waitForSelector('.loading-overlay', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForSelector('canvas', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1000);
  await screenshot(page, '02_demo_edited');

  await page.waitForTimeout(5000); // Leave the final edited PDF on screen for 5 seconds

  await browser.close();
  console.log('\n=== DEMO COMPLETE ===');
}

run().catch(err => {
  console.error('\n❌ DEMO FAILED:', err.message);
  process.exit(1);
});
