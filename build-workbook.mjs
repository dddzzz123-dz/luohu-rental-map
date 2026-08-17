import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const analysis = JSON.parse(await fs.readFile("analysis-data.json", "utf8"));
const profilesState = JSON.parse(await fs.readFile("community-profiles.json", "utf8"));
const evidence = JSON.parse(await fs.readFile("review-evidence.json", "utf8"));
const stationCommuteRows = [
  ["国贸","1",1,0,3,"一级"],["老街","1",2,0,5,"一级"],["大剧院","1",3,0,8,"一级"],["科学馆","1",4,0,10,"一级"],
  ["红岭","3→1",3,1,12,"一级"],["晒布","3→1",3,1,12,"一级"],["通新岭","3→1",4,1,15,"一级"],["翠竹","3→1",4,1,15,"一级"],
  ["湖贝","2/5→1",4,1,14,"一级"],["燕南","2→1",4,1,14,"一级"],["东门","5→1",4,1,14,"一级"],
  ["黄贝岭","2/5→1",5,1,17,"扩展"],["罗湖","1",0,0,0,"终点"]
];
const outputDir = path.resolve("..", "..", "..", "outputs", "019fdbc7-63b9-7642-9d28-f98a32c362bc");
await fs.mkdir(outputDir, { recursive: true });

const profileFor = name => {
  const data = profilesState.profiles[name];
  if (!data?.list?.length) return {};
  const norm = s => String(s || "").replace(/[·•\s（）()\-—_]/g, "").replace(/京基100/g, "京基一百");
  return data.list.find(x => norm(x["小区名称"]) === norm(name)) || data.list[0] || {};
};
const dateText = ms => ms ? new Date(ms).toISOString().slice(0, 10) : "";
const closureScore = v => v === "全封闭式" ? 5 : v === "半封闭式" ? 3.5 : v === "全开放式" ? 2 : 3;
const propertyScore = v => {
  const s = String(v || "");
  if (s === "住宅") return 5;
  if (s.includes("住宅") && !s.includes("写字楼")) return 4;
  if (s.includes("住宅")) return 3;
  return 2.5;
};
const reviewBy = new Map();
for (const item of evidence) {
  const rows = reviewBy.get(item.community) || [];
  rows.push(item);
  reviewBy.set(item.community, rows);
}

const summaryRows = analysis.summaries.map(s => {
  const p = profileFor(s.community);
  const safety = Math.round((closureScore(p["是否封闭"]) * .6 + propertyScore(p["物业用途"]) * .4) * 10) / 10;
  const comfort = Math.round((Math.min(5, Number(p["绿化率"] || 15) / 7.5) * .35 + (p["物业公司"] ? 3.5 : 2.5) * .35 + (s.walkMinutes <= 8 ? 4.5 : s.walkMinutes <= 12 ? 3.5 : 2.5) * .3) * 10) / 10;
  return { ...s, p, safety, comfort, evidenceCount: (reviewBy.get(s.community) || []).length };
});

const wb = Workbook.create();
wb.comments.setSelf({ displayName: "Codex 租房研究" });
const navy = "#17324D", teal = "#138A8A", pale = "#EAF5F4", gold = "#F2B84B", red = "#D95D39", gray = "#64748B";
const addSheet = name => { const s = wb.worksheets.add(name); s.showGridLines = false; return s; };
const title = (sheet, text, subtitle, endCol) => {
  sheet.mergeCells(`A1:${endCol}1`); sheet.getRange("A1").values = [[text]];
  sheet.getRange(`A1:${endCol}1`).format = { fill: navy, font: { bold: true, color: "#FFFFFF", size: 18 }, rowHeight: 30, verticalAlignment: "center" };
  sheet.mergeCells(`A2:${endCol}2`); sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A2:${endCol}2`).format = { fill: pale, font: { color: navy, italic: true }, wrapText: true, rowHeight: 32, verticalAlignment: "center" };
};
const styleTable = (sheet, range, tableName) => {
  const table = sheet.tables.add(range, true, tableName); table.style = "TableStyleMedium2"; table.showFilterButton = true;
  sheet.getRange(range.split(":")[0].replace(/\d+$/, "4") + ":" + range.split(":")[1].replace(/\d+$/, "4")).format = { fill: teal, font: { bold: true, color: "#FFFFFF" }, wrapText: true };
  sheet.freezePanes.freezeRows(4);
  return table;
};

const s = addSheet("小区决策总表");
title(s, "罗湖通勤租房｜小区决策总表", "范围：罗湖口岸4公里内、11个一级站点1公里内、整租一居/一室一厅、2400–5000元。最终总分由可编辑权重计算；先筛中位租金与步行，再看安全/评价证据。", "Y");
s.getRange("A4:Y4").values = [["初选名次","小区/大厦","类型判断","最佳地铁站","步行米","步行分钟","直线米(对照)","稳健均租","中位租金","P25","P75","有效库存","原始挂牌","异常/重复","样本置信","封闭管理","物业用途","安全基础分","舒适基础分","评价证据数","通勤分","价格分","库存分","总分","建议"]];
s.getRange("AA1:AB1").values=[["权重维度","每1分权重"]];
s.getRange("AA2:AB6").values=[["通勤",7],["安全",5],["价格",5],["库存",3],["舒适",1]];
s.getRange("AA1:AB6").format={fill:"#FEF3C7",font:{color:"#78350F"},borders:{preset:"outside",style:"thin",color:"#D97706"}};
s.getRange("AA1:AB1").format={fill:gold,font:{bold:true,color:navy}};
const summaryValues = summaryRows.map((x, i) => [i + 1,x.community,x.propertyCategory,x.station,x.walkDistance,x.walkMinutes,x.straightDistance,x.robustAverage,x.median,x.p25,x.p75,x.effectiveCount,x.rawCount,x.suspiciousCount,x.sampleConfidence,x.p["是否封闭"] || "待核",x.p["物业用途"] || "待核",x.safety,x.comfort,x.evidenceCount,null,null,null,null,""]);
s.getRangeByIndexes(4, 0, summaryValues.length, 25).values = summaryValues;
const end = 4 + summaryValues.length;
s.getRange(`U5`).formulas = [["=MAX(0,5-F5/5)"]]; s.getRange(`U5:U${end}`).fillDown();
s.getRange(`V5`).formulas = [["=MAX(0,MIN(5,(5000-I5)/520))"]]; s.getRange(`V5:V${end}`).fillDown();
s.getRange(`W5`).formulas = [["=MIN(5,LOG(L5+1,2))"]]; s.getRange(`W5:W${end}`).fillDown();
s.getRange(`X5`).formulas = [["=ROUND(U5*$AB$2+R5*$AB$3+V5*$AB$4+W5*$AB$5+S5*$AB$6,1)"]]; s.getRange(`X5:X${end}`).fillDown();
s.getRange(`Y5`).formulas = [["=IF(AND(F5<=8,I5<=3800,R5>=3.5,L5>=6),\"优先看房\",IF(AND(F5<=12,I5<=4500,R5>=3),\"可进入备选\",\"谨慎/低优先\"))"]]; s.getRange(`Y5:Y${end}`).fillDown();
styleTable(s, `A4:Y${end}`, "CommunityDecisionTable");
s.getRange(`E5:G${end}`).format.numberFormat = "0"; s.getRange(`F5:F${end}`).format.numberFormat = "0.0";
s.getRange(`H5:K${end}`).format.numberFormat = "¥#,##0"; s.getRange(`R5:X${end}`).format.numberFormat = "0.0";
s.getRange(`X5:X${end}`).conditionalFormats.add("colorScale", { thresholds: ["min","50%","max"], colors: ["#FEE2E2","#FEF3C7","#D1FAE5"] });
s.getRange(`Y5:Y${end}`).conditionalFormats.add("containsText", { text: "优先", format: { fill: "#D1FAE5", font: { bold: true, color: "#065F46" } } });
[7,8,9,10].forEach(c => s.getRangeByIndexes(4,c,summaryValues.length,1).format.columnWidth = 12);
s.getRange("A:Y").format.font = { name: "Microsoft YaHei", size: 10 };
const widths = [9,20,16,10,9,10,11,11,11,10,10,10,10,11,9,11,20,11,11,10,9,9,9,9,13]; widths.forEach((w,i)=>s.getRangeByIndexes(0,i,end,1).format.columnWidth=w);
s.getRange("Z:Z").format.columnWidth=3; s.getRange("AA:AA").format.columnWidth=12; s.getRange("AB:AB").format.columnWidth=12;

const raw = addSheet("原始房源");
title(raw,"乐有家原始房源与清洗结果","每行保留原链接。有效=用于小区稳健统计；异常行仍保留，方便人工复核是否合租、引流或重复挂牌。","R");
const rawHeaders=["小区","挂牌名","地铁站","步行参考分钟","租金","面积㎡","元/㎡","户型","朝向","装修","物业类型","有效","清洗原因","疑似重复签名","图片数","有图判定","房源链接","抓取批次"];
raw.getRange("A4:R4").values=[rawHeaders];
const sumMap=new Map(summaryRows.map(x=>[x.community,x]));
const rawVals=analysis.rawRows.map(r=>{const c=sumMap.get(r.sourceCommunity); return [r.sourceCommunity,r.name,c?.station||r.station,c?.walkMinutes||null,r.rent,r.area,r.pricePerSqm,r.layout,r.direction,r.decor,r.propertyClass,r.effective?"是":"否",r.cleanReason,r.signature,r.photoCount,"未知（未逐条补齐）",r.url,analysis.generatedAt.slice(0,10)]});
raw.getRangeByIndexes(4,0,rawVals.length,18).values=rawVals; const rawEnd=4+rawVals.length; styleTable(raw,`A4:R${rawEnd}`,"RawRentalTable");
raw.getRange(`E5:G${rawEnd}`).format.numberFormat="¥#,##0.0"; raw.getRange(`D5:D${rawEnd}`).format.numberFormat="0.0";
raw.getRange(`L5:L${rawEnd}`).conditionalFormats.add("containsText",{text:"否",format:{fill:"#FEE2E2",font:{color:"#991B1B"}}});
[18,18,10,10,10,9,10,10,9,9,14,8,18,25,9,16,48,12].forEach((w,i)=>raw.getRangeByIndexes(0,i,rawEnd,1).format.columnWidth=w);

const routes=addSheet("步行路线");
title(routes,"高德实际步行路线","起点为高德小区POI中心点、终点为地铁站点坐标；不是直线距离。实际门禁/出口可造成约1–5分钟误差，签约前请用具体楼栋入口复核。","G");
routes.getRange("A4:G4").values=[["小区","候选站","步行米","步行分钟","是否最快","测量时间","高德POI地址"]];
const routeVals=[]; for(const [name,x] of Object.entries(analysis.routeState.completed)){for(const rr of x.routes)routeVals.push([name,rr.station,rr.distance,Math.round(rr.duration/6)/10,rr.station===x.bestRoute?.station?"是":"",x.measuredAt.slice(0,19).replace("T"," "),x.address]);}
routes.getRangeByIndexes(4,0,routeVals.length,7).values=routeVals; const routeEnd=4+routeVals.length; styleTable(routes,`A4:G${routeEnd}`,"WalkingRoutesTable");
routes.getRange(`C5:D${routeEnd}`).format.numberFormat="0.0"; [20,10,10,11,9,20,45].forEach((w,i)=>routes.getRangeByIndexes(0,i,routeEnd,1).format.columnWidth=w);

const profiles=addSheet("小区档案");
title(profiles,"小区档案与安全线索","档案来自乐有家 communitySearch；空值表示接口未返回。开放式/商住混合会降低安全基础分，但最终仍需夜间实地验证门禁、楼道、电梯分流和周边照明。","Q");
const ph=["小区","接口匹配名","地址","建成年代","封闭管理","物业用途","开发商","物业公司","物业费","停车费","绿化率%","容积率","停车位","楼栋数","学校","小区详情链接","小区图片"];
profiles.getRange("A4:Q4").values=[ph];
const pv=summaryRows.map(x=>{const p=x.p;return[x.community,p["小区名称"]||"未命中",p["小区地址"]||"",dateText(p["建筑年代"]),p["是否封闭"]||"待核",p["物业用途"]||"待核",p["开发商户"]||"",p["物业公司"]||"",p["物业费用"]||"",p["停车费"]||"",p["绿化率"]??null,p["容积率"]??null,p["停车位"]??null,p["楼栋数"]??null,(p["附近学校"]||[]).join("、"),String(p["小区详情地址"]||"").replace(/\?.*$/,""),p["小区图片"]||""]});
profiles.getRangeByIndexes(4,0,pv.length,17).values=pv; const pe=4+pv.length; styleTable(profiles,`A4:Q${pe}`,"CommunityProfileTable"); [20,18,38,12,12,22,24,24,14,18,10,10,10,9,32,48,48].forEach((w,i)=>profiles.getRangeByIndexes(0,i,pe,1).format.columnWidth=w);

const ev=addSheet("评价与跨平台证据");
title(ev,"评价与跨平台交叉验证","经纪人挂牌文案、平台攻略与住户评价严格分开；可信度不等同真伪结论。没有稳定公开数据的小区不会虚构“零评价”。","I");
ev.getRange("A4:I4").values=[["小区","来源","证据类型","摘要","倾向","可信度","链接","限制/备注","采集日期"]];
const evv=evidence.map(x=>[x.community,x.source,x.evidenceType,x.summary,x.sentiment,x.credibility,x.url,x.note,"2026-08-14"]); ev.getRangeByIndexes(4,0,evv.length,9).values=evv; const ee=4+evv.length; styleTable(ev,`A4:I${ee}`,"EvidenceTable"); [20,16,18,55,14,12,55,55,12].forEach((w,i)=>ev.getRangeByIndexes(0,i,ee,1).format.columnWidth=w); ev.getRange(`D5:I${ee}`).format.wrapText=true;

const xhs=addSheet("小红书转租线索");
title(xhs,"小红书个人转租/看房线索","只收可还原链接且信息足够的条目。低互动仅是“可能更个人化”的筛选信号，不代表一定真实；本轮公开检索无法稳定取得帖子列表，因此不以不可审计截图凑数。","J");
xhs.getRange("A4:J4").values=[["关联小区","帖子类型","发布时间","价格","点赞/收藏","真实性信号","风险信号","可信度","链接","备注"]];
xhs.getRange("A5:J6").values=[
  ["多小区/罗湖港深通勤","线下看房总结","待核","预算4000上下","待核","列出具体小区与优缺点、个人看房叙述","截图未完整显示发布日期与互动，需重新打开核验","中","https://www.xiaohongshu.com/explore/6a50c0b7000000000702dcd0","现有浏览截图已见；链接token可能失效。"],
  ["—","覆盖说明","2026-08-13",null,"—","—","公开网页搜索对小区级帖子召回不稳定","不适用","https://www.xiaohongshu.com/","建议用户登录后按推荐小区名+转租搜索，补充最新低互动个人帖。"]
]; styleTable(xhs,"A4:J6","XhsLeadTable"); [22,16,12,12,14,38,42,12,55,48].forEach((w,i)=>xhs.getRangeByIndexes(0,i,6,1).format.columnWidth=w); xhs.getRange("F5:J6").format.wrapText=true;

const rules=addSheet("Rules");
title(rules,"统计口径、权重与限制","黄色单元格可调整权重。总分只是初筛工具，不替代实地看房；安全是偏好项，需重点核门禁、楼道、电梯、夜间路线和消防疏散。","H");
rules.getRange("A4:C9").values=[["评分维度","每1分权重","说明"],["通勤",7,"步行分钟换算0–5分"],["安全",5,"封闭管理60%+物业用途40%"],["价格",5,"中位租金越接近低预算越高"],["库存",3,"有效库存取log，避免大盘支配"],["舒适",1,"绿化、物业信息完整度、步行便利的弱权重"]];
rules.getRange("B5:B9").format={fill:"#FEF3C7",font:{bold:true,color:"#92400E"},numberFormat:"0.0"}; rules.getRange("A4:C9").format.borders={preset:"outside",style:"thin",color:"#94A3B8"};
rules.getRange("A12:H12").values=[["规则编号","规则","触发条件","统计处理","为何这样做","误伤风险","审计位置","版本"]];
const rr=[
 ["R1","URL精确去重","相同房源URL","仅保留一条","避免分页/关键词重复","低","原始房源","v1"],
 ["R2","疑似重复挂牌","同小区+户型+整数面积+租金+朝向相同","只计一次有效库存","多个经纪人可能发布同一套","可能是同规格不同房","原始房源·签名","v1"],
 ["R3","异常低价","低于IQR下界或低于小区中位数65%或㎡单价低于中位58%","排除稳健均价并待核","识别合租/引流/单位错误","特价真房可能被排除","原始房源·清洗原因","v1"],
 ["R4","异常高价","高于IQR上界","排除稳健均价","避免豪装/极端单位抬高均值","优质装修可能被排除","原始房源·清洗原因","v1"],
 ["R5","稳健均租","有效样本>=10时两端各截10%后平均，否则普通平均","作为均价","减少极端值影响","小样本仍不稳","小区决策总表","v1"],
 ["R6","有效库存","排除重复与异常后的URL数","与原始挂牌同时展示","区分营销曝光和可比库存","不是物理房屋实时数量","小区决策总表","v1"]
]; rules.getRangeByIndexes(12,0,rr.length,8).values=rr; styleTable(rules,`A12:H${12+rr.length}`,"RulesTable"); [10,18,40,22,35,30,22,9].forEach((w,i)=>rules.getRangeByIndexes(0,i,20,1).format.columnWidth=w); rules.getRange("A12:H20").format.wrapText=true;
rules.getRange("E5").comment = "总表总分公式直接引用这些权重；可按个人偏好调整。";

const stationSheet=addSheet("站点通勤");
title(stationSheet,"一级站点到罗湖通勤","地铁时间为站到站估算，已包含正常换乘耗时，不含小区步行、进站和极端候车。完整通勤请将本表地铁分钟与“小区决策总表”的步行分钟相加。","G");
stationSheet.getRange("A4:G4").values=[["站点","线路/换乘","乘坐站数","换乘次数","地铁估算分钟","范围","口径说明"]];
const stationValues=stationCommuteRows.map(row=>[...row,"目的地为1号线罗湖站"]);
stationSheet.getRangeByIndexes(4,0,stationValues.length,7).values=stationValues;
const stationEnd=4+stationValues.length; styleTable(stationSheet,`A4:G${stationEnd}`,"StationCommuteTable");
[12,14,11,11,14,10,32].forEach((w,i)=>stationSheet.getRangeByIndexes(0,i,stationEnd,1).format.columnWidth=w);
stationSheet.getRange(`C5:E${stationEnd}`).format.numberFormat="0";
stationSheet.getRange(`F5:F${stationEnd}`).conditionalFormats.add("containsText",{text:"一级",format:{fill:"#D1FAE5",font:{bold:true,color:"#065F46"}}});

const sources=addSheet("来源与覆盖");
title(sources,"来源、覆盖与可信边界","所有关键来源都保留URL。平台在租数量受重复、过期与展示策略影响；高德路线随道路数据更新可能变化。","F");
sources.getRange("A4:F4").values=[["来源","用途","覆盖","时间","URL","限制"]];
sources.getRange("A5:F11").values=[
 ["乐有家 house/search","一居挂牌与链接","146小区 / 1,355条","2026-08-14","https://wap.leyoujia.com/wap/openclaw/ai/house/search","接口单次最多30条；已通过价格分段与小区关键词补查"],
 ["乐有家 communitySearch","小区档案","146小区","2026-08-14","https://wap.leyoujia.com/wap/openclaw/ai/communitySearch","部分别名无档案或字段为空"],
 ["高德周边搜索","住宅POI前置清单","11个一级站点；口岸4km且站点1km","2026-08-14","https://restapi.amap.com/v5/place/around","POI类型可能混入商住楼，已保留类型核验"],
 ["高德步行规划","实际路网距离/时间","146个有房小区 / 396条候选路线","2026-08-14","https://restapi.amap.com/v3/direction/walking","起点为POI中心，非楼栋门口"],
 ["安居客/房天下/克而瑞","跨平台库存/评价线索","重点候选抽样","2026-08-13","https://shenzhen.anjuke.com/","库存口径不明，营销文案降权"],
 ["小红书","个人看房/转租线索","低覆盖","2026-08-13","https://www.xiaohongshu.com/","搜索结果依赖登录与临时token；只保留可审计链接"],
 ["GitHub工具调研","采集方案评估","redbook/MediaCrawler/旧链家爬虫","2026-08-13","https://github.com/666ghj/MindSpider","需登录/验证码或旧页面适配，未把未经验证脚本当数据源"]
]; styleTable(sources,"A4:F11","SourcesTable"); [18,24,26,14,58,60].forEach((w,i)=>sources.getRangeByIndexes(0,i,11,1).format.columnWidth=w); sources.getRange("A4:F11").format.wrapText=true;

for (const sheet of wb.worksheets.items) sheet.getUsedRange()?.format.font && (sheet.getUsedRange().format.font.name = "Microsoft YaHei");

for (const [sheetName, range] of [["小区决策总表","A1:Y20"],["原始房源","A1:R22"],["步行路线","A1:G22"],["小区档案","A1:Q20"],["评价与跨平台证据","A1:I18"],["小红书转租线索","A1:J8"],["Rules","A1:H20"],["站点通勤","A1:G18"],["来源与覆盖","A1:F12"]]) {
  const preview = await wb.render({ sheetName, range, scale: .9, format: "png" });
  await fs.writeFile(path.join(outputDir, `preview-${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const check = await wb.inspect({ kind: "table", range: "小区决策总表!A1:Y15", include: "values,formulas", tableMaxRows: 15, tableMaxCols: 25, maxChars: 12000 });
await fs.writeFile(path.join(outputDir,"inspection.ndjson"),check.ndjson,"utf8");
const errors = await wb.inspect({ kind:"match", searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options:{useRegex:true,maxResults:300}, summary:"final formula error scan" });
await fs.writeFile(path.join(outputDir,"formula-errors.ndjson"),errors.ndjson,"utf8");
const out = await SpreadsheetFile.exportXlsx(wb);
const xlsxPath = path.join(outputDir,"罗湖通勤租房_小区均价与步行通勤决策表_2026-08-14.xlsx");
await out.save(xlsxPath);
console.log(JSON.stringify({xlsxPath, sheets: wb.worksheets.items.map(x=>x.name), communities:summaryRows.length, listings:analysis.rawRows.length, routeRows:routeVals.length, formulaErrors:errors.ndjson},null,2));
