import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("../../../.artifact_cityu_is/node_modules/playwright");

function parseAssignment(text, prefix) {
  return JSON.parse(text.replace(prefix, "").replace(/;\s*$/, ""));
}

const [baseText, scanText, photoText, existingText] = await Promise.all([
  fs.readFile("data.js", "utf8"),
  fs.readFile("scan.js", "utf8"),
  fs.readFile("photo-counts.js", "utf8"),
  fs.readFile("images.js", "utf8").catch(() => "window.RENTAL_IMAGES={};")
]);
const base = parseAssignment(baseText, /^window\.RENTAL_DATA=/);
const scan = parseAssignment(scanText, /^window\.RENTAL_SCAN=/);
const photoCounts = parseAssignment(photoText, /^window\.RENTAL_PHOTO_COUNTS=/).counts;
const existing = parseAssignment(existingText, /^window\.RENTAL_IMAGES\s*=\s*/);
const scannedStations = new Set(["红岭", "老街", "晒布", "东门片区", "大剧院", "湖贝", "黄贝岭", "国贸", "罗湖"]);
const combined = [...scan.rentals, ...base.rentals.filter(item => !scannedStations.has(item.station))]
  .filter(item => item.rent >= 2400 && item.rent <= 4500);
const rentals = [...new Map(combined.map(item => [item.url.replace(/\?.*$/, ""), { ...item, url: item.url.replace(/\?.*$/, "") }])).values()];
const activeUrls = new Set(rentals.map(item => item.url));
const galleries = Object.fromEntries(Object.entries(existing).filter(([url]) => activeUrls.has(url)));
const todo = rentals.filter(item => Number(photoCounts[item.url] ?? item.photoCount ?? 0) >= 2 && !(galleries[item.url]?.length));
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const failures = [];
let cursor = 0;

function detailUrl(url) {
  return `${url}${url.includes("?") ? "&" : "?"}utm_term=lyj_token_fks`;
}

async function inspect(page, rental, index) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await page.goto(detailUrl(rental.url), { waitUntil: "domcontentloaded", timeout: 25000 });
      if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`);
      const images = await page.locator("img[data-original]").evaluateAll(elements => [...new Set(elements
        .map(image => image.getAttribute("data-original"))
        .filter(Boolean)
        .filter(url => url.includes("fang-community.leyoujia.com"))
        .filter(url => !/default_detail|error_detail|\/w\/568\/h\/426/.test(url)))]
        .slice(0, 12));
      if (images.length) galleries[rental.url] = images;
      process.stderr.write(`BACKFILL ${index + 1}/${todo.length} ${images.length} ${rental.name}\n`);
      return;
    } catch (error) {
      if (attempt === 2) failures.push({ url: rental.url, message: error.message });
    }
  }
}

async function worker() {
  const page = await browser.newPage();
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.continue() : route.abort());
  while (cursor < todo.length) {
    const index = cursor++;
    await inspect(page, todo[index], index);
  }
  await page.close();
}

await Promise.all(Array.from({ length: 6 }, () => worker()));
await browser.close();
const output = Object.fromEntries(Object.entries(galleries)
  .filter(([, images]) => Array.isArray(images) && images.length)
  .sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile("images.js", `window.RENTAL_IMAGES=${JSON.stringify(output)};\n`, "utf8");
const withGallery = Object.keys(output).length;
const imageTotal = Object.values(output).reduce((sum, images) => sum + images.length, 0);
console.log(JSON.stringify({ rentals: rentals.length, requested: todo.length, withGallery, imageTotal, failures: failures.length }, null, 2));
