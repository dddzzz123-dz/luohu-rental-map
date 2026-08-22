import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("../../../.artifact_cityu_is/node_modules/playwright");
const community = process.argv.slice(2).join(" ").trim();
if (!community) throw new Error("Usage: node verify-community-gallery.mjs <community>");

function parseAssignment(text, prefix) {
  return JSON.parse(text.replace(prefix, "").replace(/;\s*$/, ""));
}

const [scanText, photoText, imageText] = await Promise.all([
  fs.readFile("scan.js", "utf8"),
  fs.readFile("photo-counts.js", "utf8"),
  fs.readFile("images.js", "utf8")
]);
const scan = parseAssignment(scanText, /^window\.RENTAL_SCAN=/);
const photoPayload = parseAssignment(photoText, /^window\.RENTAL_PHOTO_COUNTS=/);
const images = parseAssignment(imageText, /^window\.RENTAL_IMAGES\s*=\s*/);
const rentals = scan.rentals.filter(item => item.sourceCommunity === community || item.name === community);
if (!rentals.length) throw new Error(`No rentals found for ${community}`);

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
let cursor = 0;
const failures = [];

async function inspect(page, rental) {
  try {
    await page.goto(`${rental.url}?utm_term=lyj_token_fks`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const body = await page.locator("body").innerText();
    const match = body.match(/房源图片\((\d+)\)/);
    const gallery = await page.locator("img[data-original]").evaluateAll(elements => [...new Set(elements
      .map(image => image.getAttribute("data-original"))
      .filter(Boolean)
      .filter(url => url.includes("fang-community.leyoujia.com"))
      .filter(url => !/default_detail|error_detail|\/w\/568\/h\/426/.test(url)))].slice(0, 12));
    const count = match ? Number(match[1]) : gallery.length || null;
    photoPayload.counts[rental.url] = count;
    if (gallery.length) images[rental.url] = gallery;
    process.stderr.write(`VERIFY ${community} ${count ?? "?"}图 ${gallery.length}入库 ${rental.url}\n`);
  } catch (error) {
    failures.push({ url: rental.url, message: error.message });
  }
}

async function worker() {
  const page = await browser.newPage();
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.continue() : route.abort());
  while (cursor < rentals.length) await inspect(page, rentals[cursor++]);
  await page.close();
}

await Promise.all(Array.from({ length: Math.min(4, rentals.length) }, () => worker()));
await browser.close();

const activeUrls = new Set(scan.rentals.map(item => item.url));
photoPayload.counts = Object.fromEntries(Object.entries(photoPayload.counts).filter(([url]) => activeUrls.has(url)));
const values = Object.values(photoPayload.counts);
const verified = values.filter(Number.isFinite);
photoPayload.updated = new Date().toISOString();
photoPayload.stats = {
  total: scan.rentals.length,
  withImages: verified.filter(value => value >= 2).length,
  withoutImages: verified.filter(value => value <= 1).length,
  unknown: values.length - verified.length,
  errors: failures.length
};
const sortedImages = Object.fromEntries(Object.entries(images)
  .filter(([url, gallery]) => activeUrls.has(url) && Array.isArray(gallery) && gallery.length)
  .sort(([a], [b]) => a.localeCompare(b)));
await Promise.all([
  fs.writeFile("photo-counts.js", `window.RENTAL_PHOTO_COUNTS=${JSON.stringify(photoPayload)};\n`, "utf8"),
  fs.writeFile("photo-counts.json", `${JSON.stringify(photoPayload.counts, null, 2)}\n`, "utf8"),
  fs.writeFile("images.js", `window.RENTAL_IMAGES=${JSON.stringify(sortedImages)};\n`, "utf8")
]);
console.log(JSON.stringify({ community, rentals: rentals.length, galleries: rentals.filter(item => sortedImages[item.url]?.length).length, failures: failures.length, photoStats: photoPayload.stats }, null, 2));
