import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("../../../.artifact_cityu_is/node_modules/playwright");

function parseAssignment(text, prefix) {
  return JSON.parse(text.replace(prefix, "").replace(/;\s*$/, ""));
}

const [scanText, photoText, imageText, stateText] = await Promise.all([
  fs.readFile("scan.js", "utf8"),
  fs.readFile("photo-counts.js", "utf8"),
  fs.readFile("images.js", "utf8"),
  fs.readFile("gallery-scan-state.json", "utf8").catch(() => "{}")
]);
const scan = parseAssignment(scanText, /^window\.RENTAL_SCAN=/);
const photoCounts = parseAssignment(photoText, /^window\.RENTAL_PHOTO_COUNTS=/).counts;
const galleries = parseAssignment(imageText, /^window\.RENTAL_IMAGES\s*=\s*/);
const checked = stateText.trim() ? JSON.parse(stateText) : {};
const limit = Number(process.env.GALLERY_BATCH_LIMIT || 100);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const candidates = scan.rentals
  .filter(rental => !(galleries[rental.url]?.length) && !checked[rental.url])
  .sort((a, b) => {
    const aVerified = Number(photoCounts[a.url]) >= 2 ? 1 : 0;
    const bVerified = Number(photoCounts[b.url]) >= 2 ? 1 : 0;
    return bVerified - aVerified || a.station.localeCompare(b.station, "zh-CN") || a.distance - b.distance;
  })
  .slice(0, limit);

async function save() {
  const active = new Set(scan.rentals.map(rental => rental.url));
  const output = Object.fromEntries(Object.entries(galleries)
    .filter(([url, images]) => active.has(url) && Array.isArray(images) && images.length)
    .sort(([a], [b]) => a.localeCompare(b)));
  const imageTemp = "images.js.tmp";
  const stateTemp = "gallery-scan-state.json.tmp";
  await Promise.all([
    fs.writeFile(imageTemp, `window.RENTAL_IMAGES=${JSON.stringify(output)};\n`, "utf8"),
    fs.writeFile(stateTemp, `${JSON.stringify(checked, null, 2)}\n`, "utf8")
  ]);
  await Promise.all([
    fs.rename(imageTemp, "images.js"),
    fs.rename(stateTemp, "gallery-scan-state.json")
  ]);
}

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage();
await page.route("**/*", route => route.request().resourceType() === "document" ? route.continue() : route.abort());
let addedListings = 0;
let addedImages = 0;
let blocked = false;

for (let index = 0; index < candidates.length; index++) {
  const rental = candidates[index];
  try {
    const response = await page.goto(`${rental.url}?utm_term=lyj_token_fks`, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (response?.status() === 403) {
      blocked = true;
      process.stderr.write(`BLOCKED ${index + 1}/${candidates.length}\n`);
      break;
    }
    if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`);
    const images = await page.locator("img[data-original]").evaluateAll(elements => [...new Set(elements
      .map(image => image.getAttribute("data-original"))
      .filter(Boolean)
      .filter(url => url.includes("fang-community.leyoujia.com"))
      .filter(url => !/default_detail|error_detail|\/w\/568\/h\/426/.test(url)))]
      .slice(0, 12));
    checked[rental.url] = { checkedAt: new Date().toISOString(), imageCount: images.length };
    if (images.length) {
      galleries[rental.url] = images;
      addedListings += 1;
      addedImages += images.length;
    }
    process.stderr.write(`BATCH ${index + 1}/${candidates.length} ${images.length} ${rental.name}\n`);
    if ((index + 1) % 10 === 0) await save();
    await sleep(900);
  } catch (error) {
    checked[rental.url] = { checkedAt: new Date().toISOString(), error: error.message };
  }
}

await save();
await browser.close();
console.log(JSON.stringify({ requested: candidates.length, addedListings, addedImages, blocked, totalGalleries: Object.keys(galleries).filter(url => scan.rentals.some(rental => rental.url === url)).length }, null, 2));
