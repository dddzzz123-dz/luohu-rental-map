import fs from "node:fs/promises";

const key = process.env.LYJ_API_KEY;
if (!key) throw new Error("LYJ_API_KEY is required");
const limit = Number(process.env.DEEP_BATCH_LIMIT || 25);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stripHtml = value => String(value || "").replace(/<[^>]+>/g, "").trim();
const normalize = value => stripHtml(value)
  .replace(/京基100/g, "京基一百")
  .replace(/廣場/g, "广场")
  .replace(/[·•\s（）()\-—_]/g, "")
  .replace(/[，,。]/g, "")
  .toLowerCase();

const scanText = await fs.readFile("scan.js", "utf8");
const scan = JSON.parse(scanText.replace(/^window\.RENTAL_SCAN=/, "").replace(/;\s*$/, ""));
const stateText = await fs.readFile("deep-scan-state.json", "utf8").catch(() => "{}");
const state = stateText.trim() ? JSON.parse(stateText) : {};
state.checked ||= {};
state.saturated ||= [];
state.requests ||= 0;

let lastRequest = 0;
async function request(body) {
  await sleep(Math.max(0, 360 - (Date.now() - lastRequest)));
  lastRequest = Date.now();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch("https://wap.leyoujia.com/wap/openclaw/ai/house/search", {
        method: "POST",
        headers: { "X-Api-Key": key, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.requests += 1;
      return response.json();
    } catch (error) {
      lastError = error;
      await sleep(attempt * 1000);
    }
  }
  throw lastError;
}

async function exhaustiveKeyword(keyword, priceMin = 2400, priceMax = 5000, areaMin = null, areaMax = null) {
  const body = { type: "zf", city: "深圳", keyword, room: "1", priceMin, priceMax };
  if (areaMin != null) Object.assign(body, { areaMin, areaMax });
  const result = await request(body);
  const list = Array.isArray(result.list) ? result.list : [];
  const total = Number(result.total) || list.length;
  if (total <= 30) return list;
  if (priceMin < priceMax) {
    const midpoint = Math.floor((priceMin + priceMax) / 2);
    return [
      ...await exhaustiveKeyword(keyword, priceMin, midpoint, areaMin, areaMax),
      ...await exhaustiveKeyword(keyword, midpoint + 1, priceMax, areaMin, areaMax)
    ];
  }
  if (areaMin == null) return exhaustiveKeyword(keyword, priceMin, priceMax, 1, 500);
  if (areaMin < areaMax) {
    const midpoint = Math.floor((areaMin + areaMax) / 2);
    return [
      ...await exhaustiveKeyword(keyword, priceMin, priceMax, areaMin, midpoint),
      ...await exhaustiveKeyword(keyword, priceMin, priceMax, midpoint + 1, areaMax)
    ];
  }
  const faceted = [...list];
  for (const orientation of [69, 70, 71, 72, 73, 74, 75, 76, 77, 78]) {
    const result = await request({ ...body, orientation });
    faceted.push(...(Array.isArray(result.list) ? result.list : []));
  }
  let unique = [...new Map(faceted.map(item => [stripHtml(item["详情地址"]).replace(/\?.*$/, ""), item])).values()];
  if (unique.length < total) {
    for (const fitment of [46, 47, 48, 49]) {
      const result = await request({ ...body, fitment });
      unique.push(...(Array.isArray(result.list) ? result.list : []));
    }
    unique = [...new Map(unique.map(item => [stripHtml(item["详情地址"]).replace(/\?.*$/, ""), item])).values()];
  }
  if (unique.length < total) state.saturated.push({ keyword, price: priceMin, area: areaMin, total, recovered: unique.length });
  return unique;
}

function matchesAny(foundName, names) {
  const found = normalize(foundName);
  return names.some(name => {
    const candidate = normalize(name);
    return found === candidate || (Math.min(found.length, candidate.length) >= 3 && (found.includes(candidate) || candidate.includes(found)));
  });
}

function toRental(item, community) {
  const url = stripHtml(item["详情地址"]).replace(/\?.*$/, "");
  return {
    id: `scan-${url.split("/").pop()?.split(".")[0] || Math.random().toString(36).slice(2)}`,
    name: stripHtml(item["小区名称"]),
    station: community.nearestStation,
    distance: community.distance,
    rent: Number(item["租金"]),
    area: Number(item["建筑面积"]),
    layout: `${item["室"] || 1}室${/1房1厅/.test(stripHtml(item["标题"])) ? 1 : 0}厅${item["卫"] ?? ""}卫`.replace(/卫$/, ""),
    direction: stripHtml(item["朝向"]) || "待核",
    decor: stripHtml(item["装修"]) || "待核",
    propertyClass: stripHtml(item["房屋类型"]) || (community.typeCodes.includes("120302") ? "住宅小区" : "商住楼"),
    rec: community.typeCodes.includes("120302") ? "高德·住宅小区" : community.typeCodes.includes("120303") ? "高德·宿舍住宅" : "高德·商住候选",
    target: 3500,
    photoCount: null,
    sourceCommunity: community.name,
    url
  };
}

async function saveState() {
  const temp = "deep-scan-state.json.tmp";
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temp, "deep-scan-state.json");
}

const forceCommunity = process.env.DEEP_FORCE_COMMUNITY || "";
const activeCommunities = scan.communities
  .filter(community => community.listingCount > 0 && (forceCommunity ? community.name === forceCommunity : !state.checked[community.name]))
  .sort((a, b) => b.listingCount - a.listingCount || a.distance - b.distance)
  .slice(0, limit);
const byUrl = new Map(scan.rentals.map(rental => [rental.url, rental]));
let added = 0;

for (let index = 0; index < activeCommunities.length; index++) {
  const community = activeCommunities[index];
  const knownNames = [...new Set(scan.rentals.filter(rental => rental.sourceCommunity === community.name).map(rental => rental.name).concat(community.name))];
  state.saturated = state.saturated.filter(item => !knownNames.some(name => normalize(name) === normalize(item.keyword)));
  const keywords = [...new Map(knownNames.map(name => [normalize(name), name])).values()];
  const found = [];
  for (const keyword of keywords) found.push(...await exhaustiveKeyword(keyword));
  const unique = [...new Map(found.map(item => [stripHtml(item["详情地址"]).replace(/\?.*$/, ""), item])).values()]
    .filter(item => matchesAny(item["小区名称"], knownNames));
  for (const item of unique) {
    const rental = toRental(item, community);
    if (!rental.url || rental.rent < 2400 || rental.rent > 5000) continue;
    const existing = byUrl.get(rental.url);
    if (!existing) added += 1;
    if (!existing || rental.distance < existing.distance) byUrl.set(rental.url, rental);
  }
  state.checked[community.name] = { checkedAt: new Date().toISOString(), keywords, found: unique.length };
  await saveState();
  process.stderr.write(`DEEP ${index + 1}/${activeCommunities.length} ${community.name} ${unique.length} total=${byUrl.size}\n`);
}

scan.rentals = [...byUrl.values()].sort((a, b) => a.station.localeCompare(b.station, "zh-CN") || a.distance - b.distance || a.rent - b.rent);
for (const community of scan.communities) community.listingCount = scan.rentals.filter(rental => rental.sourceCommunity === community.name).length;
scan.stats.communitiesWithListings = scan.communities.filter(community => community.listingCount > 0).length;
scan.stats.matchedRentals = scan.rentals.length;
scan.updated = new Date().toISOString();
const scanTemp = "scan.js.tmp";
await fs.writeFile(scanTemp, `window.RENTAL_SCAN=${JSON.stringify(scan)};\n`, "utf8");
await fs.rename(scanTemp, "scan.js");
console.log(JSON.stringify({ processed: activeCommunities.length, added, totalRentals: scan.rentals.length, checkedCommunities: Object.keys(state.checked).length, requests: state.requests, saturated: state.saturated.length }, null, 2));
