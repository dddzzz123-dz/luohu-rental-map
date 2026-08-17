import fs from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const scanText = fs.readFileSync(dir + "scan.js", "utf8");
const scan = JSON.parse(scanText.replace(/^window\.RENTAL_SCAN=/, "").replace(/;\s*$/, ""));

let routes = { completed: {} };
try { routes = JSON.parse(fs.readFileSync(dir + "route-state.json", "utf8")); } catch {}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// 找佳兆业中心（及其相关名）
const hit = scan.communities.filter(c => c.name.includes("佳兆业") || c.name.includes("Kaisa") || c.name.includes("凯撒"));
console.log("=== 命中的小区 ===");
for (const c of hit) {
  console.log(`${c.name} | 最近站=${c.nearestStation} | 直线${c.distance}m | typeCodes=${(c.typeCodes||[]).join(",")} | 挂牌${c.listingCount}`);
}

// 佳兆业中心的房源明细
const kaisa = scan.communities.find(c => c.name.includes("佳兆业"));
if (kaisa) {
  const rs = scan.rentals.filter(r => r.sourceCommunity === kaisa.name);
  const walk = routes.completed[kaisa.name]?.bestRoute || {};
  console.log(`\n=== ${kaisa.name} 房源明细 ===`);
  console.log(`步行到站: ${walk.station} ${walk.distance ? Math.round(walk.distance)+"m/"+Math.round(walk.duration/60)+"min" : "未知"}`);
  console.log(`挂牌 ${rs.length} 套，中位 ${median(rs.map(r=>r.rent))} 元`);
  console.log(`≤3500: ${rs.filter(r=>r.rent<=3500).length} 套 | ≤3900: ${rs.filter(r=>r.rent<=3900).length} 套`);
  for (const r of rs.sort((a,b)=>a.rent-b.rent)) {
    console.log(`  ${r.rent}元 ${r.area}㎡ ${r.layout} ${r.direction} ${r.propertyClass} | ${r.url}`);
  }
}
