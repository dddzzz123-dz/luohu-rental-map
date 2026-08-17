import fs from "node:fs/promises";

const amapKey = process.env.AMAP_WEB_KEY;
const lyjKey = process.env.LYJ_API_KEY;
if (!amapKey || !lyjKey) throw new Error("AMAP_WEB_KEY and LYJ_API_KEY are required");

const stations = {
  通新岭: "114.096273,22.549126",
  红岭: "114.104584,22.548380",
  科学馆: "114.095173,22.540618",
  燕南: "114.092561,22.544541",
  国贸: "114.118826,22.539671",
  老街: "114.116241,22.544301",
  东门: "114.117079,22.542946",
  晒布: "114.122664,22.549238",
  翠竹: "114.129883,22.556188",
  大剧院: "114.107811,22.541800",
  湖贝: "114.125439,22.544286",
  黄贝岭: "114.136332,22.546095",
  罗湖: "114.118623,22.531861"
};
const luohuPort = "114.118895,22.528393";
const residentialTypes = ["120302", "120303", "120203", "120300"];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchWithRetry(url, options, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) return response;
      lastError = new Error(`${label} HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(attempt * 1200);
  }
  throw lastError;
}
const stripHtml = value => String(value || "").replace(/<[^>]+>/g, "").trim();
const normalize = value => stripHtml(value)
  .replace(/京基100/g, "京基一百")
  .replace(/廣場/g, "广场")
  .replace(/[·•\s（）()\-—_]/g, "")
  .replace(/[，,。]/g, "")
  .toLowerCase();

function distanceMeters(a, b) {
  const [lng1, lat1] = a.split(",").map(Number);
  const [lng2, lat2] = b.split(",").map(Number);
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function queryName(name) {
  const aliases = {
    "京基100大厦": "京基一百大厦",
    "KKMALL京基百纳空间羲和雅苑": "羲和雅苑",
    "和平广场A栋玉庭轩": "玉庭轩",
    "华庭轩(河边北路)": "华庭轩",
    "桂木园(桂园路)": "桂木园",
    "和平大厦(和平路)": "和平大厦",
    "和平大厦A座(和平路)": "和平大厦",
    "慢以致远公寓(南湖路分店)": "慢以致远公寓",
    "浣花堂林晨公寓(深南东路分店)": "浣花堂林晨公寓",
    "信兴广场·地王公寓": "地王公寓",
    "园岭新村一区": "园岭新村",
    "海燕广場": "海燕广场"
  };
  return aliases[name] || name.replace(/[（(].*?[）)]/g, "").replace(/-南区$/, "");
}

function queryVariants(name) {
  const primary = queryName(name);
  const variants = [
    primary,
    primary.replace(/[A-ZＡ-Ｚ]\d*座$/i, ""),
    primary.replace(/(?:东区|西区|南区|北区|一区|二区|三区|四区|一期|二期|三期|四期)$/u, ""),
    primary.replace(/(?:员工宿舍楼?|教师宿舍楼?|职工公寓|生活区|家属大院)$/u, "宿舍")
  ].map(value => value.trim()).filter(value => normalize(value).length >= 3);
  return [...new Set(variants)];
}

function isMatch(foundName, poiName, keyword) {
  const found = normalize(foundName);
  const candidates = [normalize(poiName), normalize(keyword)].filter(Boolean);
  return candidates.some(candidate => found === candidate || (Math.min(found.length, candidate.length) >= 3 && (found.includes(candidate) || candidate.includes(found))));
}

async function amapAround(station, location, typeCode) {
  const rows = [];
  for (let page = 1; page <= 8; page++) {
    const url = new URL("https://restapi.amap.com/v5/place/around");
    url.search = new URLSearchParams({ key: amapKey, location, radius: "1000", types: typeCode, sortrule: "distance", page_size: "25", page_num: String(page) });
    const response = await fetchWithRetry(url, undefined, "AMap");
    const result = await response.json();
    if (result.status !== "1") throw new Error(`AMap ${result.infocode}`);
    const pois = Array.isArray(result.pois) ? result.pois : [];
    for (const poi of pois) {
      const portDistance = distanceMeters(luohuPort, poi.location);
      if (Number(poi.distance) <= 1000 && portDistance <= 4000) rows.push({ station, name: poi.name, distance: Number(poi.distance), portDistance, location: poi.location, typeCode, type: poi.type });
    }
    if (pois.length < 25) break;
    await sleep(360);
  }
  return rows;
}

let lyjGate = Promise.resolve();
let lastLyjRequest = 0;
async function lyjRequest(body) {
  let release;
  const previous = lyjGate;
  lyjGate = new Promise(resolve => { release = resolve; });
  await previous;
  await sleep(Math.max(0, 360 - (Date.now() - lastLyjRequest)));
  lastLyjRequest = Date.now();
  release();
  const response = await fetchWithRetry("https://wap.leyoujia.com/wap/openclaw/ai/house/search", {
    method: "POST",
    headers: { "X-Api-Key": lyjKey, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  }, "LYJ");
  if (!response.ok) throw new Error(`LYJ HTTP ${response.status}`);
  return response.json();
}

async function lyjSearch(community) {
  const keywords = queryVariants(community.name);
  let keyword = keywords[0];
  async function searchKeyword(value) {
    const baseBody = { type: "zf", city: "深圳", keyword: value, room: "1", priceMin: 2400, priceMax: 5000 };
    const first = await lyjRequest(baseBody);
    let candidates = Array.isArray(first.list) ? first.list : [];
    if (candidates.length >= 30 || Number(first.total) > 30) {
      const bands = [[2400, 2999], [3000, 3499], [3500, 3999], [4000, 4499], [4500, 5000]];
      const banded = [];
      for (const [priceMin, priceMax] of bands) {
        const result = await lyjRequest({ ...baseBody, priceMin, priceMax });
        banded.push(...(Array.isArray(result.list) ? result.list : []));
      }
      candidates = banded;
    }
    return candidates;
  }
  let candidates = await searchKeyword(keyword);
  let matches = candidates.filter(item => isMatch(item["小区名称"], community.name, keyword));
  for (const variant of keywords.slice(1)) {
    if (matches.length) break;
    keyword = variant;
    candidates = await searchKeyword(keyword);
    matches = candidates.filter(item => isMatch(item["小区名称"], community.name, keyword));
  }
  const uniqueCandidates = [...new Map(candidates.map(item => [stripHtml(item["详情地址"]), item])).values()];
  matches = uniqueCandidates.filter(item => isMatch(item["小区名称"], community.name, keyword));
  return matches.map(item => ({
    id: `scan-${stripHtml(item["详情地址"]).split("/").pop()?.split(".")[0] || Math.random().toString(36).slice(2)}`,
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
    url: stripHtml(item["详情地址"]).replace(/\?.*$/, "")
  })).filter(item => item.url && item.rent >= 2400 && item.rent <= 5000);
}

const amapRows = [];
for (const [station, location] of Object.entries(stations)) {
  for (const typeCode of residentialTypes) amapRows.push(...await amapAround(station, location, typeCode));
}

const grouped = new Map();
for (const row of amapRows) {
  const current = grouped.get(row.name) || [];
  current.push(row);
  grouped.set(row.name, current);
}
const communities = [...grouped.entries()].map(([name, rows]) => {
  const nearest = [...rows].sort((a, b) => a.distance - b.distance)[0];
  return {
    name,
    nearestStation: nearest.station,
    distance: nearest.distance,
    portDistance: nearest.portDistance,
    typeCodes: [...new Set(rows.map(row => row.typeCode))].sort(),
    stations: [...new Set(rows.map(row => row.station))],
    listingCount: 0
  };
}).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, "zh-CN"));

let cursor = 0;
const found = [];
const errors = [];
async function worker(workerId) {
  while (cursor < communities.length) {
    const index = cursor++;
    const community = communities[index];
    process.stderr.write(`LYJ ${index + 1}/${communities.length} [${workerId}] ${community.name}\n`);
    try {
      const rentals = await lyjSearch(community);
      community.listingCount = rentals.length;
      found.push(...rentals);
    } catch (error) {
      errors.push({ community: community.name, error: error.message });
    }
  }
}
await Promise.all([worker(1), worker(2), worker(3)]);

const byUrl = new Map();
for (const rental of found) {
  const existing = byUrl.get(rental.url);
  if (!existing || rental.distance < existing.distance) byUrl.set(rental.url, rental);
}
const rentals = [...byUrl.values()].sort((a, b) => a.station.localeCompare(b.station, "zh-CN") || a.distance - b.distance || a.rent - b.rent);
const stationCoverage = Object.fromEntries(Object.keys(stations).map(station => [station, new Set(amapRows.filter(row => row.station === station).map(row => row.name)).size]));
const scan = {
  updated: new Date().toISOString(),
  stats: {
    amapRawRecords: amapRows.length,
    amapUniqueCommunities: communities.length,
    stationCoverage,
    queriedCommunities: communities.length,
    communitiesWithListings: communities.filter(item => item.listingCount > 0).length,
    matchedRentals: rentals.length,
    stationRadiusMeters: 1000,
    portRadiusMeters: 4000,
    errors: errors.length
  },
  communities,
  rentals
};
await fs.writeFile("scan.js", `window.RENTAL_SCAN=${JSON.stringify(scan)};\n`, "utf8");
await fs.writeFile("scan-summary.json", `${JSON.stringify(scan.stats, null, 2)}\n`, "utf8");
console.log(JSON.stringify(scan.stats, null, 2));
