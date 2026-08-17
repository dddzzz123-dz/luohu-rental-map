import fs from "node:fs/promises";
import vm from "node:vm";

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(await fs.readFile("scan.js", "utf8"), ctx);
const scan = ctx.window.RENTAL_SCAN;
const routeState = JSON.parse(await fs.readFile("route-state.json", "utf8"));

const quantile = (sorted, p) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const round = (value, digits = 0) => value == null ? null : Number(value.toFixed(digits));

const grouped = new Map();
for (const item of scan.rentals) {
  const rows = grouped.get(item.sourceCommunity) || [];
  rows.push({ ...item });
  grouped.set(item.sourceCommunity, rows);
}

const rawRows = [];
const summaries = [];
for (const [community, rows] of grouped) {
  const rents = rows.map(r => r.rent).sort((a, b) => a - b);
  const p25 = quantile(rents, .25), median = quantile(rents, .5), p75 = quantile(rents, .75);
  const iqr = p75 - p25;
  const ppsm = rows.map(r => r.rent / r.area).filter(Number.isFinite).sort((a, b) => a - b);
  const ppsmMedian = quantile(ppsm, .5);
  const seen = new Map();
  for (const r of rows) {
    const signature = [r.name, r.layout, Math.round(r.area), r.rent, r.direction].join("|");
    const duplicateLike = seen.has(signature);
    if (!duplicateLike) seen.set(signature, r.url);
    const lowByIqr = rows.length >= 4 && r.rent < p25 - 1.5 * iqr;
    const highByIqr = rows.length >= 4 && r.rent > p75 + 1.5 * iqr;
    const lowVsMedian = rows.length >= 3 && r.rent < median * .65;
    const lowPpsm = rows.length >= 5 && (r.rent / r.area) < ppsmMedian * .58;
    const invalidArea = !Number.isFinite(r.area) || r.area < 12 || r.area > 100;
    const reasons = [];
    if (duplicateLike) reasons.push("疑似重复挂牌");
    if (lowByIqr || lowVsMedian || lowPpsm) reasons.push("异常低价待核");
    if (highByIqr) reasons.push("异常高价");
    if (invalidArea) reasons.push("面积异常");
    const effective = !duplicateLike && !lowByIqr && !lowVsMedian && !lowPpsm && !highByIqr && !invalidArea;
    rawRows.push({ ...r, signature, pricePerSqm: round(r.rent / r.area, 1), effective, cleanReason: reasons.join("；") || "保留" });
  }
  let valid = rawRows.filter(r => r.sourceCommunity === community && r.effective);
  if (!valid.length) valid = rawRows.filter(r => r.sourceCommunity === community && !r.cleanReason.includes("疑似重复挂牌"));
  const validRents = valid.map(r => r.rent).sort((a, b) => a - b);
  const trim = validRents.length >= 10 ? Math.floor(validRents.length * .1) : 0;
  const trimmed = validRents.slice(trim, validRents.length - trim || undefined);
  const route = routeState.completed[community];
  const meta = scan.communities.find(c => c.name === community) || {};
  const housing = rows.filter(r => /住宅|花园|小区|家园|苑|村|大院|宿舍/.test(`${r.propertyClass}${r.rec}${community}`)).length;
  const residentialShare = housing / rows.length;
  const safetyBase = residentialShare >= .7 ? 4 : residentialShare >= .35 ? 3 : 2;
  const walkMinutes = route?.bestRoute ? route.bestRoute.duration / 60 : null;
  const commuteScore = walkMinutes == null ? 0 : Math.max(0, 5 - walkMinutes / 5);
  const priceScore = Math.max(0, Math.min(5, (5000 - quantile(validRents, .5)) / 520));
  const stockScore = Math.min(5, Math.log2(valid.length + 1));
  const quantitativeScore = 35 * commuteScore / 5 + 25 * safetyBase / 5 + 25 * priceScore / 5 + 15 * stockScore / 5;
  summaries.push({
    community,
    propertyCategory: residentialShare >= .7 ? "住宅小区倾向" : residentialShare >= .35 ? "混合住宅/公寓" : "商住大厦倾向",
    station: route?.bestRoute?.station || meta.nearestStation || "",
    walkDistance: route?.bestRoute?.distance ?? null,
    walkMinutes: round(walkMinutes, 1),
    straightDistance: meta.distance ?? null,
    portStraightDistance: route?.portStraightDistance ?? meta.portDistance ?? null,
    rawCount: rows.length,
    effectiveCount: valid.length,
    suspiciousCount: rows.length - valid.length,
    robustAverage: round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length),
    median: round(quantile(validRents, .5)),
    p25: round(quantile(validRents, .25)),
    p75: round(quantile(validRents, .75)),
    min: validRents[0],
    max: validRents.at(-1),
    safetyBase,
    quantitativeScore: round(quantitativeScore, 1),
    sampleConfidence: valid.length >= 15 ? "高" : valid.length >= 6 ? "中" : "低",
    amapName: route?.amapName || "",
    amapAddress: route?.address || "",
    measuredAt: route?.measuredAt || ""
  });
}

summaries.sort((a, b) => b.quantitativeScore - a.quantitativeScore || b.effectiveCount - a.effectiveCount);
summaries.forEach((row, index) => row.quantitativeRank = index + 1);
await fs.writeFile("analysis-data.json", `${JSON.stringify({ generatedAt: new Date().toISOString(), summaries, rawRows, routeState }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ communities: summaries.length, listings: rawRows.length, effective: rawRows.filter(r => r.effective).length, top: summaries.slice(0, 25) }, null, 2));
