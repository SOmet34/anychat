const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));

  // Use the live site (fall back to local file if offline)
  const url = 'https://somet34.github.io/anychat/';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(async () => {
    await page.goto('file:///C:/Users/somet/OneDrive/Documents/ClaudeFreellm/New/index.html', { waitUntil: 'domcontentloaded' });
  });

  await page.waitForSelector('#settingsModal', { timeout: 15000 });
  const open = await page.evaluate(() => document.getElementById('settingsModal').hidden);
  console.log('Modal initially hidden?', open);

  // Fill in all fields
  await page.fill('#apiKeyInput', 'sk-test-key-123');
  await page.fill('#baseUrlInput', 'https://api.openai.com');
  await page.fill('#modelInput', 'gpt-4o');
  await page.fill('#tempInput', '0.7');
  await page.fill('#maxTokensInput', '2000');
  await page.selectOption('#providerSelect', 'openai');

  // Confirm modal is open
  const before = await page.evaluate(() => document.getElementById('settingsModal').hidden);
  console.log('Modal hidden after fill (should be false):', before);

  // Click the X button
  await page.click('#closeSettingsBtn');

  const after = await page.evaluate(() => document.getElementById('settingsModal').hidden);
  console.log('Modal hidden after clicking X (should be true):', after);

  // Also test Esc
  await page.click('#topSettingsBtn');
  const beforeEsc = await page.evaluate(() => document.getElementById('settingsModal').hidden);
  await page.keyboard.press('Escape');
  const afterEsc = await page.evaluate(() => document.getElementById('settingsModal').hidden);
  console.log('Esc closes modal (should be true):', afterEsc);

  console.log('Browser console errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(after === true ? 0 : 1);
})();