import fs from "node:fs/promises";

const amapKey = process.env.AMAP_WEB_KEY;
const lyjKey = process.env.LYJ_API_KEY;
if (!amapKey || !lyjKey) throw new Error("AMAP_WEB_KEY and LYJ_API_KEY are required");

const addedStations = {
  通新岭: "114.096273,22.549126",
  科学馆: "114.095173,22.540618",
  燕南: "114.092561,22.544541",
  翠竹: "114.129883,22.556188",
  东门: "114.117079,22.542946"
};
const luohuPort = "114.118895,22.528393";
const residentialTypes = ["120302", "120303", "120203", "120300"];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stripHtml = value => String(value || "").replace(/<[^>]+>/g, "").trim();
const normalize = value => stripHtml(value)
  .replace(/京基100/g, "京基一百")
  .replace(/廣場/g, "广场")
  .replace(/[·•\s（）()\-—_，,。]/g, "")
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

async function amapAround(station, location, typeCode) {
  const rows = [];
  for (let page = 1; page <= 8; page++) {
    const url = new URL("https://restapi.amap.com/v5/place/around");
    url.search = new URLSearchParams({
      key: amapKey,
      location,
      radius: "1000",
      types: typeCode,
      sortrule: "distance",
      page_size: "25",
      page_num: String(page)
    });
    const response = await fetchWithRetry(url, undefined, `AMap ${station}`);
    const result = await response.json();
    if (result.status !== "1") throw new Error(`AMap ${result.infocode}`);
    const pois = Array.isArray(result.pois) ? result.pois : [];
    for (const poi of pois) {
      const portDistance = distanceMeters(luohuPort, poi.location);
      if (Number(poi.distance) <= 1000 && portDistance <= 4000) {
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
    "园岭新村一区": "园岭新村",
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

let lastLyjRequest = 0;
async function lyjRequest(body) {
  await sleep(Math.max(0, 360 - (Date.now() - lastLyjRequest)));
  lastLyjRequest = Date.now();
  const response = await fetchWithRetry("https://wap.leyoujia.com/wap/openclaw/ai/house/search", {
    method: "POST",
    headers: { "X-Api-Key": lyjKey, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  }, "LYJ");
  if (!response.ok) throw new Error(`LYJ HTTP ${response.status}`);
  return response.json();
}

async function searchKeyword(keyword) {
  const base = { type: "zf", city: "深圳", keyword, room: "1", priceMin: 2400, priceMax: 5000 };
  const first = await lyjRequest(base);
  let list = Array.isArray(first.list) ? first.list : [];
  if (list.length >= 30 || Number(first.total) > 30) {
    list = [];
    for (const [priceMin, priceMax] of [[2400, 2999], [3000, 3499], [3500, 3999], [4000, 4499], [4500, 5000]]) {
      const result = await lyjRequest({ ...base, priceMin, priceMax });
      list.push(...(Array.isArray(result.list) ? result.list : []));
    }
  }
  return list;
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

async function searchCommunity(community) {
  const variants = queryVariants(community.name);
  for (const keyword of variants) {
    const candidates = await searchKeyword(keyword);
    const unique = [...new Map(candidates.map(item => [stripHtml(item["详情地址"]).replace(/\?.*$/, ""), item])).values()];
    const matches = unique.filter(item => isMatch(item["小区名称"], community.name, keyword));
    if (matches.length) return matches.map(item => toRental(item, community)).filter(item => item.url && item.rent >= 2400 && item.rent <= 5000);
  }
  return [];
}

const scanText = await fs.readFile("scan.js", "utf8");
const scan = JSON.parse(scanText.replace(/^window\.RENTAL_SCAN=/, "").replace(/;\s*$/, ""));
const rows = [];
for (const [station, location] of Object.entries(addedStations)) {
  for (const typeCode of residentialTypes) rows.push(...await amapAround(station, location, typeCode));
  process.stderr.write(`AMAP ${station}: ${rows.filter(row => row.station === station).length}\n`);
}

const groupedRows = new Map();
for (const row of rows) {
  const bucket = groupedRows.get(row.name) || [];
  bucket.push(row);
  groupedRows.set(row.name, bucket);
}

const communitiesByName = new Map(scan.communities.map(community => [community.name, community]));
const newlyDiscovered = [];
for (const [name, stationRows] of groupedRows) {
  const nearest = [...stationRows].sort((a, b) => a.distance - b.distance)[0];
  let community = communitiesByName.get(name);
  if (!community) {
    community = {
      name,
      nearestStation: nearest.station,
      distance: nearest.distance,
      portDistance: nearest.portDistance,
      typeCodes: [...new Set(stationRows.map(row => row.typeCode))].sort(),
      stations: [...new Set(stationRows.map(row => row.station))],
      listingCount: 0
    };
    communitiesByName.set(name, community);
    newlyDiscovered.push(community);
  } else {
    community.stations = [...new Set([...(community.stations || [community.nearestStation]), ...stationRows.map(row => row.station)])];
    community.typeCodes = [...new Set([...(community.typeCodes || []), ...stationRows.map(row => row.typeCode)])].sort();
    if (nearest.distance < Number(community.distance ?? Infinity)) {
      community.nearestStation = nearest.station;
      community.distance = nearest.distance;
      community.portDistance = nearest.portDistance;
    }
  }
}

const byUrl = new Map(scan.rentals.map(rental => [rental.url, rental]));
const errors = [];
for (let index = 0; index < newlyDiscovered.length; index++) {
  const community = newlyDiscovered[index];
  process.stderr.write(`LYJ ${index + 1}/${newlyDiscovered.length} ${community.name}\n`);
  try {
    const rentals = await searchCommunity(community);
    for (const rental of rentals) if (!byUrl.has(rental.url)) byUrl.set(rental.url, rental);
  } catch (error) {
    errors.push({ community: community.name, error: error.message });
  }
}

const mergedCommunities = [...communitiesByName.values()];
const metricsByName = new Map(mergedCommunities.map(community => [community.name, community]));
for (const rental of byUrl.values()) {
  const community = metricsByName.get(rental.sourceCommunity);
  if (community) {
    rental.station = community.nearestStation;
    rental.distance = community.distance;
  }
}
const rentals = [...byUrl.values()].sort((a, b) => a.station.localeCompare(b.station, "zh-CN") || a.distance - b.distance || a.rent - b.rent);
const countsByCommunity = new Map();
for (const rental of rentals) countsByCommunity.set(rental.sourceCommunity, (countsByCommunity.get(rental.sourceCommunity) || 0) + 1);
for (const community of mergedCommunities) community.listingCount = countsByCommunity.get(community.name) || 0;

scan.communities = mergedCommunities.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, "zh-CN"));
scan.rentals = rentals;
scan.updated = new Date().toISOString();
scan.stats.amapRawRecords = Number(scan.stats.amapRawRecords || 0) + rows.length;
scan.stats.amapUniqueCommunities = scan.communities.length;
scan.stats.stationCoverage ||= {};
for (const station of Object.keys(addedStations)) {
  scan.stats.stationCoverage[station] = new Set(rows.filter(row => row.station === station).map(row => row.name)).size;
}
scan.stats.queriedCommunities = Number(scan.stats.queriedCommunities || 0) + newlyDiscovered.length;
scan.stats.communitiesWithListings = scan.communities.filter(community => community.listingCount > 0).length;
scan.stats.matchedRentals = rentals.length;
scan.stats.errors = Number(scan.stats.errors || 0) + errors.length;

const temp = "scan.js.tmp";
await fs.writeFile(temp, `window.RENTAL_SCAN=${JSON.stringify(scan)};\n`, "utf8");
await fs.rename(temp, "scan.js");
const summary = {
  updated: scan.updated,
  stationsAdded: Object.keys(addedStations),
  amapRows: rows.length,
  amapUniqueAroundAddedStations: groupedRows.size,
  newlyDiscoveredCommunities: newlyDiscovered.length,
  totalCommunities: scan.communities.length,
  totalRentals: rentals.length,
  stationCoverage: Object.fromEntries(Object.keys(addedStations).map(station => [station, scan.stats.stationCoverage[station]])),
  stationListings: Object.fromEntries(Object.keys(addedStations).map(station => [station, rentals.filter(rental => rental.station === station).length])),
  errors
};
await fs.writeFile("primary-expansion-summary.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
