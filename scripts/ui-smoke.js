'use strict';

// Real-browser smoke test for the web editor. Drives the page like a user:
// select template, bind every slot, type variables, preview, overflow hint,
// and submit a formal render. Run while the server is up on PORT.

const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
// rootless Chromium: surface the user-space shared libs downloaded for this env
const extraLibDirs = (process.env.BROWSER_LIB_DIRS || '')
  .split(':').filter(Boolean);
if (extraLibDirs.length) {
  process.env.LD_LIBRARY_PATH = [
    ...extraLibDirs, process.env.LD_LIBRARY_PATH || '',
  ].join(':');
}

async function main() {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const failures = [];
  page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    // a 422 on preview/render is the expected rejection path, not a bug
    if (msg.type() === 'error' && !msg.text().includes('422')) failures.push(`console: ${msg.text()}`);
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#templateSelect option').length > 0);

  // pick aurora
  await page.selectOption('#templateSelect', 'aurora_ad');
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="background"] option').length > 1);

  // bind each slot to a dimensionally-compatible asset (assets share one
  // list, so match by kind/size rather than blindly taking the first entry)
  const slotAssetHint = {
    background: (o) => o.label.includes('1280x720') && (o.label.includes('.mp4')),
    logo: (o) => o.label.includes('320x180'),
    endcard: (o) => o.label.includes('1280x720') && (o.label.includes('.png')),
  };
  for (const slot of ['background', 'logo', 'endcard']) {
    const sel = page.locator(`[data-slot="${slot}"]`);
    const optionCount = await sel.locator('option').count();
    let chosen = null;
    for (let i = 1; i < optionCount; i += 1) {
      const label = await sel.locator('option').nth(i).innerText();
      if (slotAssetHint[slot]({ label })) {
        chosen = await sel.locator('option').nth(i).getAttribute('value');
        break;
      }
    }
    if (!chosen) throw new Error(`no compatible asset found for slot ${slot}`);
    await sel.selectOption(chosen);
  }

  // type canonical variables
  await page.fill('[data-var="title"]', 'AURORA LIGHT');
  await page.fill('[data-var="tagline"]', 'Feel the glow of a new day');

  // generate preview
  await page.fill('#previewTime', '3');
  await page.click('#previewBtn');
  await page.waitForFunction(() => {
    const img = document.querySelector('#previewImg');
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 60000 });
  const previewNatural = await page.evaluate(() => {
    const img = document.querySelector('#previewImg');
    return { w: img.naturalWidth, h: img.naturalHeight };
  });
  console.log('preview image natural size:', JSON.stringify(previewNatural));
  if (previewNatural.w !== 1280 || previewNatural.h !== 720) failures.push('preview size wrong');

  // long-title overflow must show measured metrics
  await page.fill('[data-var="title"]', 'AURORA LIGHT PRESENTS THE BIGGEST MIDNIGHT SUN CELEBRATION EVENT OF THE ENTIRE DECADE WITH LIVE PERFORMANCES');
  await page.click('#previewBtn');
  await page.waitForFunction(
    () => [...document.querySelectorAll('#issues .err')].some((el) => el.textContent.includes('TEXT_OVERFLOW')),
    null, { timeout: 30000 },
  );
  const issueText = await page.locator('#issues .err').filter({ hasText: 'TEXT_OVERFLOW' }).first().innerText();
  console.log('overflow issue:\n', issueText);
  if (!issueText.includes('TEXT_OVERFLOW') || !issueText.includes('实测')) failures.push('overflow hint missing measured metrics');
  const badgeBlocked = await page.locator('#validateBadge').innerText();
  console.log('badge after overflow:', badgeBlocked);

  // restore valid title and submit a formal render
  await page.fill('[data-var="title"]', 'AURORA LIGHT');
  await page.click('#renderBtn');
  await page.waitForSelector('#jobs .job', { timeout: 30000 });

  // poll the jobs panel until completed
  await page.waitForFunction(() => {
    const jobs = [...document.querySelectorAll('#jobs .job')];
    return jobs.some((j) => j.textContent.includes('completed') && j.textContent.includes('独立探测'));
  }, null, { timeout: 120000 });
  const jobText = await page.locator('#jobs .job').first().innerText();
  console.log('job panel:\n', jobText);
  if (!jobText.includes('1280x720') || !jobText.includes('10.00s') || !jobText.includes('验收 通过')) {
    failures.push('job did not show independent probe verification');
  }

  // missing-asset blocking path: unbind logo and try render
  await page.selectOption('[data-slot="logo"]', '');
  await page.click('#renderBtn');
  await page.waitForFunction(() => document.querySelector('#issues .err')?.textContent.includes('ASSET_MISSING'), null, { timeout: 30000 });
  const missingText = await page.locator('#issues .err').first().innerText();
  console.log('missing asset issue:\n', missingText);
  if (!missingText.includes('ASSET_MISSING')) failures.push('missing asset not blocked in UI');

  await page.screenshot({ path: '/tmp/editor-final.png', fullPage: false });

  if (failures.length) {
    console.error('\nUI FAILURES:', failures);
    await browser.close();
    process.exit(1);
  }
  console.log('\nUI smoke test passed: preview, measured overflow, render verification, missing-asset block');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
