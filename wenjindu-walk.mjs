import fs from "node:fs/promises";

const amapKey = process.env.AMAP_WEB_KEY;
if (!amapKey) throw new Error("AMAP_WEB_KEY is required");

const port = "114.131476,22.538479";
const stations = {
  文锦: "114.131123,22.542455",
  向西村: "114.125767,22.539792"
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function amap(url, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(260);
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.status === "1") return data;
        if (data.infocode !== "10021") throw new Error(`${label}: ${data.infocode} ${data.info}`);
      }
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await sleep(attempt * 800);
  }
  throw new Error(`${label}: failed after retries`);
}

async function walk(origin, destination, label) {
  const url = new URL("https://restapi.amap.com/v3/direction/walking");
  url.search = new URLSearchParams({ key: amapKey, origin, destination });
  const data = await amap(url, label);
  const paths = data.route?.paths || [];
  if (!paths.length) return null;
  return { distance: Number(paths[0].distance), duration: Number(paths[0].duration) };
}

const scan = JSON.parse(await fs.readFile("wenjindu-scan.json", "utf8"));
// 预算内(3200-3900)且有房源的小区
const names = [...new Set(scan.rentals.filter(r => r.rent >= 3200 && r.rent <= 3900).map(r => r.sourceCommunity))];
const communityMap = new Map(scan.communities.map(c => [c.name, c]));

const result = {};
for (let i = 0; i < names.length; i++) {
  const name = names[i];
  const community = communityMap.get(name);
  if (!community || !community.location) { result[name] = { error: "no location" }; continue; }
  process.stderr.write(`WALK ${i + 1}/${names.length} ${name}\n`);
  const entry = { community: name, location: community.location, nearestStation: community.nearestStation, straightStation: community.distance, straightPort: community.portDistance };
  try {
    const portWalk = await walk(community.location, port, `walk ${name}-port`);
    entry.portWalk = portWalk;
    const stationWalks = [];
    for (const [station, loc] of Object.entries(stations)) {
      const w = await walk(community.location, loc, `walk ${name}-${station}`);
      if (w) stationWalks.push({ station, ...w });
    }
    stationWalks.sort((a, b) => a.duration - b.duration || a.distance - b.distance);
    entry.bestStation = stationWalks[0] || null;
    entry.stationWalks = stationWalks;
  } catch (e) {
    entry.error = e.message;
  }
  result[name] = entry;
  await fs.writeFile("wenjindu-walk.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

const rows = names.map(name => {
  const e = result[name];
  const best = e.bestStation || {};
  const portWalk = e.portWalk || {};
  return {
    name,
    nearestStation: e.nearestStation,
    straightStation: e.straightStation,
    straightPort: e.straightPort,
    walkStation: best.station || "-",
    walkStationM: best.distance ?? null,
    walkStationMin: best.duration != null ? Math.round(best.duration / 60) : null,
    walkPortM: portWalk.distance ?? null,
    walkPortMin: portWalk.duration != null ? Math.round(portWalk.duration / 60) : null
  };
}).sort((a, b) => (a.walkPortM ?? 99999) - (b.walkPortM ?? 99999));

console.log("=== 预算内小区实际步行距离（高德步行路线）===");
for (const r of rows) {
  console.log(`${r.name} | 口岸直线${r.straightPort}m 口岸步行${r.walkPortM ?? "?"}m/${r.walkPortMin ?? "?"}min | 到${r.walkStation}站步行${r.walkStationM ?? "?"}m/${r.walkStationMin ?? "?"}min (直线${r.straightStation}m)`);
}
console.log("\n[saved] wenjindu-walk.json");
