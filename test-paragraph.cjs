const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function screenshot(page, name) {
  await page.screenshot({ path: `/tmp/pdf-editor-test/${name}.png` });
}

async function run() {
  if (!fs.existsSync('/tmp/pdf-editor-test')) {
    fs.mkdirSync('/tmp/pdf-editor-test', { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console errors
  page.on('pageerror', error => {
    console.error('Browser Error:', error.message);
  });
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('Browser Console Error:', msg.text());
  });

  console.log('\n=== Step 1: Load the app ===');
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1500);
  await screenshot(page, 'p01_app_loaded');

  console.log('\n=== Step 2: Upload the test PDF ===');
  const pdfPath = path.resolve(__dirname, 'test-paragraph.pdf');
  
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open PDF")'),
  ]);
  await fileChooser.setFiles(pdfPath);
  
  await page.waitForSelector('.loading-overlay', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForSelector('canvas', { state: 'visible', timeout: 10000 });
  await screenshot(page, 'p02_pdf_loaded');

  console.log('\n=== Step 3: Switch to Edit Text mode ===');
  const editTextBtn = page.getByRole('button', { name: 'Edit Text' });
  await editTextBtn.click();
  await page.waitForTimeout(500); // give time for text overlays to render
  
  // Verify overlays exist
  const textBlocks = page.locator('[contenteditable="true"]');
  const count = await textBlocks.count();
  console.log(`✅ Found ${count} grouped text blocks (expected 2 paragraphs).`);
  await screenshot(page, 'p03_edit_text_mode');

  console.log('\n=== Step 4: Shorten the first paragraph ===');
  // First paragraph is usually the first element in DOM since it has a higher Y (lower normY).
  const firstBlock = textBlocks.nth(0);
  
  // Select it and replace with shorter text
  await firstBlock.click();
  await firstBlock.fill("This is the shortened first paragraph. It is now only one line.");
  await screenshot(page, 'p04_text_edited');

  console.log('\n=== Step 5: Commit changes ===');
  // Click outside to blur and commit
  await page.mouse.click(10, 10);
  await page.waitForTimeout(500);
  await screenshot(page, 'p05_text_committed');

  console.log('\n=== Step 6: Export and Download ===');
  const downloadBtn = page.getByTitle('Download').or(page.getByRole('button', { name: /Download/i })).first();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadBtn.click()
  ]);
  
  const downloadPath = path.join(__dirname, 'test-paragraph-edited.pdf');
  await download.saveAs(downloadPath);
  console.log(`✅ Saved edited PDF to ${downloadPath}`);

  await screenshot(page, 'p06_final_state');
  await browser.close();
  console.log('\n=== ALL TESTS COMPLETE ===');
}

run().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
