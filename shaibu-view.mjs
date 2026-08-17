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

const communities = scan.communities.filter(c => c.nearestStation === "晒布");
const rentals = scan.rentals.filter(r => r.station === "晒布");

const rows = communities.map(c => {
  const rs = rentals.filter(r => r.sourceCommunity === c.name);
  const walk = routes.completed[c.name]?.bestRoute || {};
  const budget = rs.filter(r => r.rent <= 3900);
  return {
    name: c.name,
    walkM: walk.distance ?? null,
    walkMin: walk.duration != null ? Math.round(walk.duration / 60) : null,
    typeCodes: c.typeCodes,
    total: rs.length,
    rentMedian: median(rs.map(r => r.rent)),
    rentMin: rs.length ? Math.min(...rs.map(r => r.rent)) : null,
    budget3900: budget.length,
    budget3500: budget.filter(r => r.rent <= 3500).length
  };
}).sort((a, b) => (a.walkM ?? 99999) - (b.walkM ?? 99999));

console.log("=== 晒布站小区（按步行到站排序）===");
for (const r of rows) {
  const flag = (r.typeCodes.includes("120203")) ? "商住" : (r.typeCodes.includes("120303") ? "宿舍" : "住宅");
  console.log(`${r.name} | 步行${r.walkM ?? "?"}m/${r.walkMin ?? "?"}min | [${flag}] | 中位${r.rentMedian} 最低${r.rentMin} | 总${r.total}套 ≤3500:${r.budget3500} ≤3900:${r.budget3900}`);
}
