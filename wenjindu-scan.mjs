import fs from "node:fs/promises";

const amapKey = process.env.AMAP_WEB_KEY;
const lyjKey = process.env.LYJ_API_KEY;
if (!amapKey || !lyjKey) throw new Error("AMAP_WEB_KEY and LYJ_API_KEY are required");

// 文锦渡口岸为中心；文锦站/向西村站（9号线）为地铁圆心
const port = "114.131476,22.538479";
const portName = "文锦渡口岸";
const stations = {
  文锦: "114.131123,22.542455",
  向西村: "114.125767,22.539792"
};
const residentialTypes = ["120302", "120303", "120203", "120300"];
const stationRadiusMeters = 1000;
const portRadiusMeters = 4000;
const priceMin = 2400;
const priceMax = 5000;

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

async function amapAround(station, location, typeCode) {
  const rows = [];
  for (let page = 1; page <= 8; page++) {
    const url = new URL("https://restapi.amap.com/v5/place/around");
    url.search = new URLSearchParams({ key: amapKey, location, radius: String(stationRadiusMeters), types: typeCode, sortrule: "distance", page_size: "25", page_num: String(page) });
    const response = await fetchWithRetry(url, undefined, `AMap ${station}`);
    const result = await response.json();
    if (result.status !== "1") throw new Error(`AMap ${result.infocode}`);
    const pois = Array.isArray(result.pois) ? result.pois : [];
    for (const poi of pois) {
      const portDistance = distanceMeters(port, poi.location);
      if (Number(poi.distance) <= stationRadiusMeters && portDistance <= portRadiusMeters) {
        rows.push({ station, name: poi.name, distance: Number(poi.distance), portDistance, location: poi.location, typeCode, type: poi.type });
      }
    }
    if (pois.length < 25) break;
    await sleep(360);
  }
  return rows;
}

function queryName(name) {
  const aliases = {
    "京基100大厦": "京基一百大厦",
    "信兴广场·地王公寓": "地王公寓",
    "海燕廣場": "海燕广场"
  };
  return aliases[name] || name.replace(/[（(].*?[）)]/g, "").replace(/-南区$/, "");
}

function queryVariants(name) {
  const primary = queryName(name);
  return [...new Set([
    primary,
    primary.replace(/[A-ZＡ-Ｚ]\d*座$/i, ""),
    primary.replace(/(?:东区|西区|南区|北区|一区|二区|三区|四区|一期|二期|三期|四期)$/u, ""),
    primary.replace(/(?:员工宿舍楼?|教师宿舍楼?|职工公寓|生活区|家属大院)$/u, "宿舍")
  ].map(value => value.trim()).filter(value => normalize(value).length >= 3))];
}

function isMatch(foundName, poiName, keyword) {
  const found = normalize(foundName);
  return [normalize(poiName), normalize(keyword)].filter(Boolean).some(candidate =>
    found === candidate || (Math.min(found.length, candidate.length) >= 3 && (found.includes(candidate) || candidate.includes(found)))
  );
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
    const baseBody = { type: "zf", city: "深圳", keyword: value, room: "1", priceMin, priceMax };
    const first = await lyjRequest(baseBody);
    let candidates = Array.isArray(first.list) ? first.list : [];
    if (candidates.length >= 30 || Number(first.total) > 30) {
      const bands = [[2400, 2999], [3000, 3499], [3500, 3999], [4000, 4499], [4500, 5000]];
      const banded = [];
      for (const [min, max] of bands) {
        const result = await lyjRequest({ ...baseBody, priceMin: min, priceMax: max });
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
    id: `wj-${stripHtml(item["详情地址"]).split("/").pop()?.split(".")[0] || Math.random().toString(36).slice(2)}`,
    name: stripHtml(item["小区名称"]),
    station: community.nearestStation,
    stationDistance: community.distance,
    portDistance: community.portDistance,
    rent: Number(item["租金"]),
    area: Number(item["建筑面积"]),
    layout: `${item["室"] || 1}室${/1房1厅/.test(stripHtml(item["标题"])) ? 1 : 0}厅${item["卫"] ?? ""}卫`.replace(/卫$/, ""),
    direction: stripHtml(item["朝向"]) || "待核",
    decor: stripHtml(item["装修"]) || "待核",
    propertyClass: stripHtml(item["房屋类型"]) || (community.typeCodes.includes("120302") ? "住宅小区" : "商住楼"),
    rec: community.typeCodes.includes("120302") ? "高德·住宅小区" : community.typeCodes.includes("120303") ? "高德·宿舍住宅" : "高德·商住候选",
    sourceCommunity: community.name,
    url: stripHtml(item["详情地址"]).replace(/\?.*$/, "")
  })).filter(item => item.url && item.rent >= priceMin && item.rent <= priceMax);
}

// 1) 高德周边住宅 POI
const amapRows = [];
for (const [station, location] of Object.entries(stations)) {
  for (const typeCode of residentialTypes) amapRows.push(...await amapAround(station, location, typeCode));
  process.stderr.write(`AMAP ${station}: ${amapRows.filter(row => row.station === station).length} rows\n`);
}

// 2) 按名称合并小区，取最近站
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
    location: nearest.location,
    typeCodes: [...new Set(rows.map(row => row.typeCode))].sort(),
    stations: [...new Set(rows.map(row => row.station))],
    listingCount: 0
  };
}).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, "zh-CN"));

// 3) 乐有家逐个小区查整租一居（3 并发）
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

// 4) 去重（同一 URL 取更近站）
const byUrl = new Map();
for (const rental of found) {
  const existing = byUrl.get(rental.url);
  if (!existing || rental.stationDistance < existing.stationDistance) byUrl.set(rental.url, rental);
}
const rentals = [...byUrl.values()].sort((a, b) => a.portDistance - b.portDistance || a.stationDistance - b.stationDistance || a.rent - b.rent);
const stationCoverage = Object.fromEntries(Object.keys(stations).map(station => [station, new Set(amapRows.filter(row => row.station === station).map(row => row.name)).size]));
const stats = {
  updated: new Date().toISOString(),
  port: `${portName}@${port}`,
  stations,
  amapRawRecords: amapRows.length,
  amapUniqueCommunities: communities.length,
  stationCoverage,
  queriedCommunities: communities.length,
  communitiesWithListings: communities.filter(item => item.listingCount > 0).length,
  matchedRentals: rentals.length,
  errors: errors.length
};

const out = { stats, communities, rentals, errors };
await fs.writeFile("wenjindu-scan.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
await fs.writeFile("wenjindu-scan-summary.json", `${JSON.stringify(stats, null, 2)}\n`, "utf8");
console.log(JSON.stringify(stats, null, 2));
console.log(JSON.stringify({ errors }, null, 2));
