import fs from "node:fs/promises";
const key = process.env.LYJ_API_KEY;
if (!key) throw new Error("LYJ_API_KEY is required");
const analysis = JSON.parse(await fs.readFile("analysis-data.json", "utf8"));
let state = { profiles: {}, errors: {} };
try { state = JSON.parse(await fs.readFile("community-profiles.json", "utf8")); } catch {}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (let i = 0; i < analysis.summaries.length; i++) {
  const name = analysis.summaries[i].community;
  if (state.profiles[name]) continue;
  process.stderr.write(`PROFILE ${i + 1}/${analysis.summaries.length} ${name}\n`);
  try {
    await sleep(360);
    const response = await fetch("https://wap.leyoujia.com/wap/openclaw/ai/communitySearch", {
      method: "POST",
      headers: { "X-Api-Key": key, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ city: "深圳", communityKeyword: name, page: 1, pageSize: 10 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.profiles[name] = data;
    delete state.errors[name];
  } catch (error) {
    state.errors[name] = error.message;
  }
  await fs.writeFile("community-profiles.json", `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ profiles: Object.keys(state.profiles).length, errors: state.errors }, null, 2));
