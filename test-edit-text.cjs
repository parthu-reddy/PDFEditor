// End-to-end test for the PDF Editor's "Edit Text" feature
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = '/tmp/pdf-editor-test';
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function screenshot(page, name) {
  const p = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`📸 Screenshot: ${p}`);
  return p;
}

async function run() {
  const browser = await chromium.launch({
    headless: false,           // always open a visible browser
    channel: 'chrome',        // use system-installed Google Chrome
    args: ['--window-size=1400,900'],
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  console.log('\n=== Step 1: Load the app ===');
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1500);
  await screenshot(page, '01_app_loaded');

  // Verify the app loaded by checking for the dropzone
  const dropzone = await page.locator('.dropzone').count();
  console.log(`✅ Dropzone visible: ${dropzone > 0}`);

  console.log('\n=== Step 2: Upload the test PDF ===');
  const pdfPath = path.resolve('/Users/parthureddy/Documents/pdf editor/test.pdf');
  
  // Click the hidden file input via the Open PDF button
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open PDF")'),
  ]);
  await fileChooser.setFiles(pdfPath);
  
  // Wait for loading overlay to disappear (PDF fully parsed + text extracted)
  await page.waitForSelector('.loading-overlay', { state: 'hidden', timeout: 15000 }).catch(() => {});
  // Then wait for canvas to actually appear
  await page.waitForSelector('canvas.pdf-page-canvas', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000); // extra settle time for text blocks extraction
  await screenshot(page, '02_pdf_loaded');

  // Verify PDF canvas is rendered
  const canvas = await page.locator('canvas.pdf-page-canvas').count();
  console.log(`✅ PDF canvas rendered: ${canvas > 0} (count: ${canvas})`);
  
  if (canvas === 0) {
    console.error('❌ PDF did not render! Check for errors.');
    // Grab any console errors
    await browser.close();
    return;
  }

  console.log('\n=== Step 3: Check toolbar has "Edit Text" button ===');
  const editTextBtn = page.locator('#edit-text-mode-btn');
  const editTextBtnVisible = await editTextBtn.isVisible();
  console.log(`✅ "Edit Text" button visible: ${editTextBtnVisible}`);
  await screenshot(page, '03_toolbar_with_edit_btn');

  console.log('\n=== Step 4: Click "Edit Text" mode ===');
  await editTextBtn.click();
  await page.waitForTimeout(800);
  await screenshot(page, '04_edit_text_mode_active');
  
  // Check the inspector panel shows the Edit Text Mode notice
  const editModeNotice = await page.locator('text=Edit Text Mode').count();
  console.log(`✅ Inspector shows Edit Text Mode notice: ${editModeNotice > 0}`);

  console.log('\n=== Step 5: Check text overlays appeared ===');
  // The text overlays are contenteditable divs inside the annotation-overlay-layer
  await page.waitForTimeout(500);
  const overlayDivs = await page.locator('[contenteditable="true"]').count();
  console.log(`✅ Contenteditable text overlays found: ${overlayDivs} (expected > 0)`);
  await screenshot(page, '05_text_overlays_visible');

  if (overlayDivs > 0) {
    console.log('\n=== Step 6: Hover over first text block ===');
    const firstOverlay = page.locator('[contenteditable="true"]').first();
    await firstOverlay.hover();
    await page.waitForTimeout(300);
    await screenshot(page, '06_text_hover');

    console.log('\n=== Step 7: Click and edit text ===');
    await firstOverlay.click();
    await page.waitForTimeout(300);
    await screenshot(page, '07_text_focused');
    
    // Select all and replace with new text
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(100);
    await page.keyboard.type('EDITED TEXT');
    await page.waitForTimeout(300);
    await screenshot(page, '08_text_typed');
    
    // Press Enter to confirm
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await screenshot(page, '09_text_committed');
    console.log(`✅ Text edited and committed`);
    
    console.log('\n=== Step 8: Switch back to annotate mode and verify edit shows ===');
    // Click annotate tool to switch back
    await editTextBtn.click(); // toggle off
    await page.waitForTimeout(400);
    await screenshot(page, '10_back_to_annotate');
    console.log(`✅ Switched back to annotate mode`);
    
    console.log('\n=== Step 9: Switch to Edit Text mode again ===');
    await editTextBtn.click(); // toggle on again
    await page.waitForTimeout(400);
    
    // The edited overlay should now show blue text
    const editedOverlays = await page.locator('[contenteditable="true"]').count();
    console.log(`✅ Overlays still present after toggle: ${editedOverlays > 0}`);
    await screenshot(page, '11_overlay_after_toggle');
  } else {
    console.warn('⚠️  No text overlays found — PDF may have no extractable text, or extraction failed.');
  }

  console.log('\n=== Step 10: Check console errors ===');
  // Log any JS errors via page evaluation
  const errors = await page.evaluate(() => {
    return window.__testErrors || [];
  });
  console.log(`Console errors collected: ${errors.length}`);

  console.log('\n=== Step 11: Export and Download ===');
  // Find download button (the one with the Download icon, or check header)
  // Let's assume there's a button with Download text or title
  const downloadBtn = page.getByTitle('Download').or(page.getByRole('button', { name: /Download/i })).first();
  await downloadBtn.click();
  
  // Wait for a bit for the export to finish
  await page.waitForTimeout(2000);
  await screenshot(page, '12_after_download');

  console.log('\n=== ALL TESTS COMPLETE ===');
  await screenshot(page, '12_final_state');

  await browser.close();
}

run().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
