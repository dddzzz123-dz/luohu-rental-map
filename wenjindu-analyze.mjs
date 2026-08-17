import fs from "node:fs/promises";

const scan = JSON.parse(await fs.readFile("wenjindu-scan.json", "utf8"));
const rentals = scan.rentals;
const communities = scan.communities.filter(c => c.listingCount > 0);

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const band = (min, max) => r => r.rent >= min && r.rent <= max;

const summary = communities.map(c => {
  const rs = rentals.filter(r => r.sourceCommunity === c.name);
  const inIdeal = rs.filter(band(3200, 3500));
  const inSoft = rs.filter(band(3500, 3900));
  const inBudget = rs.filter(band(3200, 3900));
  return {
    name: c.name,
    station: c.nearestStation,
    stationDist: c.distance,          // 高德直线距最近站(米)
    portDist: c.portDistance,          // 直线距文锦渡口岸(米)
    typeCodes: c.typeCodes,
    total: rs.length,
    rentMin: rs.length ? Math.min(...rs.map(r => r.rent)) : null,
    rentMedian: median(rs.map(r => r.rent)),
    ideal3200_3500: inIdeal.length,
    soft3500_3900: inSoft.length,
    budget3200_3900: inBudget.length
  };
}).sort((a, b) => a.portDist - b.portDist || a.stationDist - b.stationDist);

// 预算内（3200-3900）的小区，按距口岸排序
const budgetCommunities = summary.filter(c => c.budget3200_3900 > 0);
const idealCommunities = summary.filter(c => c.ideal3200_3500 > 0);

console.log("=== 全部有房小区（按距口岸直线距离排序）===");
for (const c of summary) {
  console.log(`${c.portDist}m/口岸 ${c.stationDist}m/${c.station} ${c.name} | 总${c.total} 中位${c.rentMedian} 范围${c.rentMin} | 3200-3500:${c.ideal3200_3500} 3500-3900:${c.soft3500_3900} | ${c.typeCodes.join(",")}`);
}

console.log(`\n=== 预算内(3200-3900)小区 ${budgetCommunities.length} 个 ===`);
for (const c of budgetCommunities) {
  console.log(`${c.portDist}m/口岸 ${c.stationDist}m/${c.station} ${c.name} | 预算内${c.budget3200_3900}套 (3200-3500:${c.ideal3200_3500}, 3500-3900:${c.soft3500_3900}) 中位${c.rentMedian}`);
}

console.log(`\n=== 理想预算(3200-3500)小区 ${idealCommunities.length} 个 ===`);
for (const c of idealCommunities) {
  console.log(`${c.portDist}m/口岸 ${c.stationDist}m/${c.station} ${c.name} | 理想内${c.ideal3200_3500}套 中位${c.rentMedian}`);
}

// 预算内具体房源明细
const budgetRentals = rentals.filter(band(3200, 3900)).sort((a, b) => a.portDistance - b.portDistance || a.rent - b.rent);
console.log(`\n=== 预算内房源明细 ${budgetRentals.length} 条（按距口岸排序）===`);
for (const r of budgetRentals) {
  console.log(`${r.portDistance}m/口岸 ${r.stationDistance}m/${r.station} ${r.name} ${r.rent}元 ${r.area}㎡ ${r.layout} ${r.direction} ${r.propertyClass} ${r.rec} | ${r.url}`);
}

await fs.writeFile("wenjindu-budget-summary.json", JSON.stringify({ summary, budgetCommunities, idealCommunities, budgetRentals }, null, 2), "utf8");
console.log("\n[saved] wenjindu-budget-summary.json");
