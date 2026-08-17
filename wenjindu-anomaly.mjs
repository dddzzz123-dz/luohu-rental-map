import fs from "node:fs/promises";

const scan = JSON.parse(await fs.readFile("wenjindu-scan.json", "utf8"));
const walk = JSON.parse(await fs.readFile("wenjindu-walk.json", "utf8"));

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// 住宅 vs 商住 分组
const isResidential = c => c.typeCodes.includes("120302") && !c.typeCodes.includes("120203");
const isCommercial = c => c.typeCodes.includes("120203");

const rows = [];
for (const c of scan.communities) {
  if (!c.listingCount) continue;
  const rs = scan.rentals.filter(r => r.sourceCommunity === c.name);
  const w = walk[c.name] || {};
  const best = w.bestStation || {};
  const group = isResidential(c) ? "住宅" : isCommercial(c) ? "商住" : "其他";
  rows.push({
    name: c.name,
    group,
    station: c.nearestStation,
    walkMin: best.duration != null ? Math.round(best.duration / 60) : null,
    portWalkMin: w.portWalk?.duration != null ? Math.round(w.portWalk.duration / 60) : null,
    count: rs.length,
    rentMedian: median(rs.map(r => r.rent)),
    rentMin: Math.min(...rs.map(r => r.rent))
  });
}

// 每组中位租金（样本≥3才纳入基准）
function groupMedian(group) {
  const vals = rows.filter(r => r.group === group && r.count >= 3).map(r => r.rentMedian).filter(v => v != null);
  return median(vals);
}
const resMed = groupMedian("住宅");
const comMed = groupMedian("商住");

for (const r of rows) {
  const base = r.group === "住宅" ? resMed : r.group === "商住" ? comMed : null;
  r.groupMedian = base;
  r.dev = base != null && r.rentMedian != null ? r.rentMedian - base : null;
  // 倒挂 = 近站(≤8min) 且 明显低于同组中位(≤-250)
  r.flag = r.walkMin != null && r.walkMin <= 8 && r.dev != null && r.dev <= -250;
}

console.log(`住宅组中位租金: ${resMed}  商住组中位租金: ${comMed}\n`);
console.log("=== 越近越便宜「倒挂」检测（近站≤8min 且 明显低于同组中位）===");
console.log("(近+便宜必须有良性理由：户型极小/简装/老楼但封闭好；否则=用门禁/民水民电/品质在换钱)\n");

const sorted = [...rows].sort((a, b) => (a.walkMin ?? 99) - (b.walkMin ?? 99));
for (const r of sorted) {
  const mark = r.flag ? "⚠️倒挂" : "      ";
  const devStr = r.dev == null ? "   -" : (r.dev >= 0 ? "+" : "") + r.dev;
  const group = r.group;
  console.log(`${mark} [${group}] ${r.name} | 步行${r.walkMin ?? "?"}min到${r.station}站 | 中位${r.rentMedian} (组中位${r.groupMedian} 偏离${devStr}) | ${r.count}套`);
}

await fs.writeFile("wenjindu-anomaly.json", JSON.stringify({ resMed, comMed, rows: sorted }, null, 2), "utf8");
console.log("\n[saved] wenjindu-anomaly.json");
