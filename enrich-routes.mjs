import fs from "node:fs/promises";
import vm from "node:vm";

const amapKey = process.env.AMAP_WEB_KEY;
if (!amapKey) throw new Error("AMAP_WEB_KEY is required");

const stationLocations = {
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
const port = "114.118895,22.528393";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = value => String(value || "")
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

async function amap(url, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(260);
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data.status === "1") return data;
      if (data.infocode !== "10021") throw new Error(`${label}: ${data.infocode} ${data.info}`);
    }
    await sleep(attempt * 800);
  }
  throw new Error(`${label}: failed after retries`);
}

async function locate(name) {
  const url = new URL("https://restapi.amap.com/v5/place/text");
  url.search = new URLSearchParams({ key: amapKey, keywords: name, region: "深圳", city_limit: "true", page_size: "20" });
  const data = await amap(url, `locate ${name}`);
  const candidates = (data.pois || []).filter(poi => poi.location && distanceMeters(port, poi.location) <= 4500);
  const target = normalize(name);
  candidates.sort((a, b) => {
    const an = normalize(a.name), bn = normalize(b.name);
    const as = an === target ? 0 : (an.includes(target) || target.includes(an) ? 1 : 2);
    const bs = bn === target ? 0 : (bn.includes(target) || target.includes(bn) ? 1 : 2);
    return as - bs || distanceMeters(port, a.location) - distanceMeters(port, b.location);
  });
  return candidates[0] || null;
}

async function walk(origin, destination, label) {
  const url = new URL("https://restapi.amap.com/v3/direction/walking");
  url.search = new URLSearchParams({ key: amapKey, origin, destination });
  const data = await amap(url, label);
  const paths = data.route?.paths || [];
  if (!paths.length) return null;
  return { distance: Number(paths[0].distance), duration: Number(paths[0].duration) };
}

const context = { window: {} };
vm.createContext(context);
vm.runInContext(await fs.readFile("scan.js", "utf8"), context);
const scan = context.window.RENTAL_SCAN;
const activeNames = [...new Set(scan.rentals.map(item => item.sourceCommunity))];
const communityMap = new Map(scan.communities.map(item => [item.name, item]));
const forceRoutes = process.env.ROUTE_FORCE === "1";
const retryRouteErrors = process.env.ROUTE_RETRY_ERRORS === "1";
let state = { completed: {}, errors: {} };
try { state = JSON.parse(await fs.readFile("route-state.json", "utf8")); } catch {}

for (let i = 0; i < activeNames.length; i++) {
  const name = activeNames[i];
  if (state.completed[name] && !forceRoutes && !(retryRouteErrors && state.errors[name])) continue;
  const community = communityMap.get(name);
  process.stderr.write(`ROUTE ${i + 1}/${activeNames.length} ${name}\n`);
  try {
    const poi = await locate(name);
    if (!poi) throw new Error("未匹配到高德 POI");
    const routes = [];
    const candidateStations = community?.stations?.length ? community.stations : Object.keys(stationLocations);
    for (const station of candidateStations) {
      const stationLocation = stationLocations[station];
      if (!stationLocation || distanceMeters(poi.location, stationLocation) > 1500) continue;
      const result = await walk(poi.location, stationLocation, `walk ${name}-${station}`);
      if (result) routes.push({ station, ...result });
    }
    routes.sort((a, b) => a.duration - b.duration || a.distance - b.distance);
    state.completed[name] = {
      community: name,
      amapName: poi.name,
      location: poi.location,
      address: poi.address || "",
      poiType: poi.type || "",
      portStraightDistance: distanceMeters(port, poi.location),
      bestRoute: routes[0] || null,
      routes,
      measuredAt: new Date().toISOString(),
      routeEndpoint: "AMap v3 direction/walking"
    };
    delete state.errors[name];
  } catch (error) {
    state.errors[name] = error.message;
  }
  await fs.writeFile("route-state.json", `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ completed: Object.keys(state.completed).length, errors: state.errors }, null, 2));
