import fs from "node:fs/promises";
const analysis = JSON.parse(await fs.readFile("analysis-data.json", "utf8"));
const profiles = JSON.parse(await fs.readFile("community-profiles.json", "utf8")).profiles;
const evidence = JSON.parse(await fs.readFile("review-evidence.json", "utf8"));
const fieldVisits = JSON.parse(await fs.readFile("field-visits.json", "utf8"));
const norm = s => String(s || "").replace(/[·•\s（）()\-—_]/g, "").replace(/京基100/g, "京基一百");
const profileFor = name => {
  const list = profiles[name]?.list || [];
  return list.find(x => norm(x["小区名称"]) === norm(name)) || list[0] || {};
};
const closureScore = v => v === "全封闭式" ? 5 : v === "半封闭式" ? 3.5 : v === "全开放式" ? 2 : 3;
const propertyScore = v => {
  const s = String(v || "");
  if (s === "住宅") return 5;
  if (s.includes("住宅") && !s.includes("写字楼")) return 4;
  if (s.includes("住宅")) return 3;
  return 2.5;
};
const stationCommute = {
  国贸: { stops: 1, transfers: 0, minutes: 3 },
  老街: { stops: 2, transfers: 0, minutes: 5 },
  大剧院: { stops: 3, transfers: 0, minutes: 8 },
  科学馆: { stops: 4, transfers: 0, minutes: 10 },
  红岭: { stops: 3, transfers: 1, minutes: 12 },
  晒布: { stops: 3, transfers: 1, minutes: 12 },
  通新岭: { stops: 4, transfers: 1, minutes: 15 },
  翠竹: { stops: 4, transfers: 1, minutes: 15 },
  湖贝: { stops: 4, transfers: 1, minutes: 14 },
  燕南: { stops: 4, transfers: 1, minutes: 14 },
  东门: { stops: 4, transfers: 1, minutes: 14 },
  黄贝岭: { stops: 5, transfers: 1, minutes: 17 },
  罗湖: { stops: 0, transfers: 0, minutes: 0 }
};
const evidenceCount = new Map();
for (const row of evidence) evidenceCount.set(row.community, (evidenceCount.get(row.community) || 0) + 1);
const fieldVisitBy = new Map(fieldVisits.map(row => [row.community, row]));
const communities = analysis.summaries.map(s => {
  const p = profileFor(s.community);
  const metro = stationCommute[s.station] || { stops: null, transfers: null, minutes: 0 };
  const totalCommuteMinutes = Math.round((s.walkMinutes + metro.minutes) * 10) / 10;
  const safety = Math.round((closureScore(p["是否封闭"]) * .6 + propertyScore(p["物业用途"]) * .4) * 10) / 10;
  const commute = Math.max(0, 5 - totalCommuteMinutes / 8);
  const price = Math.max(0, Math.min(5, (5000 - s.median) / 520));
  const stock = Math.min(5, Math.log2(s.effectiveCount + 1));
  const fieldVisit = fieldVisitBy.get(s.community) || null;
  const fieldVisitPenalty = fieldVisit?.verdict === "降级" ? 12 : 0;
  const score = Math.round(Math.max(0, commute * 7 + safety * 5 + price * 5 + stock * 3 - fieldVisitPenalty) * 10) / 10;
  return {
    name: s.community, station: s.station, walkDistance: s.walkDistance, walkMinutes: s.walkMinutes,
    metroMinutes: metro.minutes, metroStops: metro.stops, transfers: metro.transfers, totalCommuteMinutes,
    straightDistance: s.straightDistance, robustAverage: s.robustAverage, median: s.median, p25: s.p25, p75: s.p75,
    effectiveCount: s.effectiveCount, rawCount: s.rawCount, suspiciousCount: s.suspiciousCount,
    confidence: s.sampleConfidence, category: s.propertyCategory, closure: p["是否封闭"] || "待核",
    propertyUse: p["物业用途"] || "待核", propertyCompany: p["物业公司"] || "待核", greenRate: p["绿化率"] ?? null,
    address: p["小区地址"] || "", communityUrl: String(p["小区详情地址"] || "").replace(/\?.*$/, ""),
    safety, score, evidenceCount: evidenceCount.get(s.community) || 0,
    fieldVisit, fieldVisitPenalty
  };
}).sort((a,b) => b.score - a.score);
communities.forEach((x,i) => x.rank = i + 1);
const out = { updated: new Date().toISOString().slice(0, 10), stats: { communities: communities.length, listings: analysis.rawRows.length, effective: analysis.rawRows.filter(x => x.effective).length, routes: Object.values(analysis.routeState.completed).reduce((n,x)=>n+x.routes.length,0) }, stationCommute, communities, evidence, fieldVisits };
await fs.writeFile("analysis.js", `window.RENTAL_ANALYSIS=${JSON.stringify(out)};\n`, "utf8");
console.log(out.stats);
