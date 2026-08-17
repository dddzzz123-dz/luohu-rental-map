import fs from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// 罗湖 11 站扫描
const scanText = fs.readFileSync(dir + "scan.js", "utf8");
const scan = JSON.parse(scanText.replace(/^window\.RENTAL_SCAN=/, "").replace(/;\s*$/, ""));
let routes = { completed: {} };
try { routes = JSON.parse(fs.readFileSync(dir + "route-state.json", "utf8")); } catch {}

// 文锦渡扫描
let wj = null;
try { wj = JSON.parse(fs.readFileSync(dir + "wenjindu-scan.json", "utf8")); } catch {}
let wjWalk = {};
try { wjWalk = JSON.parse(fs.readFileSync(dir + "wenjindu-walk.json", "utf8")); } catch {}

// 大厦/公寓型名称关键词
const TOWER = /大厦|中心|公寓|名庭|名都|SOHO|广场|苑|花园大厦|国际|金座|银座|御风|都会|环球|银来|海粤|海光/;

function rows() {
  const out = [];
  for (const c of scan.communities) {
    if (!TOWER.test(c.name)) continue;
    const rs = scan.rentals.filter(r => r.sourceCommunity === c.name);
    if (!rs.length) continue;
    const walk = routes.completed[c.name]?.bestRoute || {};
    const budget = rs.filter(r => r.rent <= 3900);
    if (!budget.length) continue;
    out.push({
      name: c.name, station: c.nearestStation,
      walkM: walk.distance ?? null,
      type: (c.typeCodes || []).includes("120203") ? "商住" : "住宅/其他",
      total: rs.length, med: median(rs.map(r => r.rent)),
      b3900: budget.length, b3500: budget.filter(r => r.rent <= 3500).length
    });
  }
  // 文锦渡
  if (wj) {
    for (const c of wj.communities) {
      if (!TOWER.test(c.name)) continue;
      const rs = wj.rentals.filter(r => r.sourceCommunity === c.name);
      if (!rs.length) continue;
      const w = wjWalk[c.name]?.bestStation || {};
      const budget = rs.filter(r => r.rent <= 3900);
      if (!budget.length) continue;
      out.push({
        name: c.name, station: c.nearestStation,
        walkM: w.distance ?? null,
        type: (c.typeCodes || []).includes("120203") ? "商住" : "住宅/其他",
        total: rs.length, med: median(rs.map(r => r.rent)),
        b3900: budget.length, b3500: budget.filter(r => r.rent <= 3500).length
      });
    }
  }
  return out;
}

const all = rows().filter(r => r.walkM != null && r.walkM <= 800);
all.sort((a, b) => a.walkM - b.walkM);

console.log("=== 近地铁(步行≤800m) + 预算内有房 的大厦/公寓型 ===\n");
for (const r of all) {
  console.log(`${r.name} | ${r.station}站 步行${r.walkM}m(${Math.round(r.walkM/75)}min) | [${r.type}] | 中位${r.med} | 总${r.total}套 ≤3500:${r.b3500} ≤3900:${r.b3900}`);
}
console.log(`\n共 ${all.length} 个候选。`);
