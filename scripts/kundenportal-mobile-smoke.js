'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const puppeteer = require('puppeteer-core');

const dbPath = path.resolve(process.env.DB_PATH || '');
if (!/(test|acceptance|abnahme)/i.test(dbPath)) throw new Error('Nur mit einer klar bezeichneten Testdatenbank erlaubt.');
const db = new Database(dbPath);
const email = process.env.PORTAL_TEST_EMAIL;
const password = process.env.PORTAL_TEST_PASSWORD;
const output = path.resolve(process.env.SCREENSHOT_PATH || path.join(process.cwd(), 'kundenportal-mobile.png'));
const original = db.prepare('SELECT must_change_password FROM customer_portal_users WHERE email=?').get(email);
if (!original) throw new Error('Testbenutzer nicht gefunden');
db.prepare('UPDATE customer_portal_users SET must_change_password=0 WHERE email=?').run(email);

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.BROWSER_PATH, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(process.env.PORTAL_BASE_URL || 'http://127.0.0.1:3011/kundenportal', { waitUntil: 'networkidle0' });
    await page.type('#login-form input[name="email"]', email);
    await page.type('#login-form input[name="password"]', password);
    await Promise.all([page.click('#login-form button[type="submit"]'), page.waitForSelector('#portal-view:not(.hidden)')]);
    await page.waitForSelector('.order-card');
    await page.click('.order-summary');
    await page.waitForSelector('.order-card.open');
    await page.screenshot({ path: output, fullPage: true });
    const result = await page.evaluate(async () => {
      const manifest = await fetch('/kundenportal-manifest.webmanifest').then(response => response.json());
      const registration = await navigator.serviceWorker.ready;
      return { width: window.innerWidth, horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        orders: document.querySelectorAll('.order-card').length, manifestIcons: manifest.icons.length,
        serviceWorkerScope: registration.scope };
    });
    console.log(JSON.stringify({ ...result, screenshot: output }));
  } finally {
    if (browser) await browser.close();
    db.prepare('UPDATE customer_portal_users SET must_change_password=? WHERE email=?').run(original.must_change_password, email);
    db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
