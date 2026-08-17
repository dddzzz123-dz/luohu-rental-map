import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("D:/HuaweiMoveData/Users/戴颖/Desktop/codex4everything/.artifact_cityu_is/node_modules/playwright");

const scanText = await fs.readFile("scan.js", "utf8");
const scan = JSON.parse(scanText.replace(/^window\.RENTAL_SCAN=/, "").replace(/;\s*$/, ""));
const rentals = scan.rentals;
const existingText = await fs.readFile("photo-counts.js", "utf8").catch(() => "");
const existing = existingText ? JSON.parse(existingText.replace(/^window\.RENTAL_PHOTO_COUNTS=/, "").replace(/;\s*$/, "")) : { counts: {} };
const pendingRentals = rentals.filter(rental => !Object.prototype.hasOwnProperty.call(existing.counts || {}, rental.url));
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const activeUrls = new Set(rentals.map(rental => rental.url));
const counts = Object.fromEntries(Object.entries(existing.counts || {}).filter(([url]) => activeUrls.has(url)));
const errors = [];
let cursor = 0;

async function inspect(page, rental, index) {
  const url = `${rental.url}?utm_term=lyj_token_fks`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const text = await page.locator("body").innerText();
      const match = text.match(/房源图片\((\d+)\)/);
      counts[rental.url] = match ? Number(match[1]) : null;
      process.stderr.write(`PHOTO ${index + 1}/${rentals.length} ${counts[rental.url]} ${rental.name}\n`);
      return;
    } catch (error) {
      if (attempt === 2) {
        counts[rental.url] = null;
        errors.push({ url: rental.url, message: error.message });
      }
    }
  }
}

async function worker() {
  const page = await browser.newPage();
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.continue() : route.abort());
  while (cursor < pendingRentals.length) {
    const index = cursor++;
    await inspect(page, pendingRentals[index], index);
  }
  await page.close();
}

await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
await browser.close();
const values = Object.values(counts);
const verified = values.filter(value => Number.isFinite(value));
const payload = {
  updated: new Date().toISOString(),
  counts,
  stats: {
    total: rentals.length,
    withImages: verified.filter(value => value >= 2).length,
    withoutImages: verified.filter(value => value <= 1).length,
    unknown: values.length - verified.length,
    errors: errors.length
  }
};
await fs.writeFile("photo-counts.js", `window.RENTAL_PHOTO_COUNTS=${JSON.stringify(payload)};\n`, "utf8");
await fs.writeFile("photo-counts.json", `${JSON.stringify(counts, null, 2)}\n`, "utf8");
console.log(JSON.stringify(payload.stats, null, 2));
