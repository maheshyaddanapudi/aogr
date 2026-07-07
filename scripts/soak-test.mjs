/** Soak: one 90-game-minute match, watching for leaks/drift — heap, scene
 * node counts, tick cost, entity counts. node scripts/soak-test.mjs */
import { chromium } from "../node_modules/playwright/index.mjs";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--js-flags=--expose-gc"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
await page.goto("http://localhost:4173/aogr/?paused&seed=4242&ai=off&pantheon=verdant_deep", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__sim !== undefined, null, { timeout: 240000 });
// a passive-ish but alive player: eco + defense, never wins → long war
await page.evaluate(() => {
  window.__soak = () => {
    const S = window.__sim, P = S.players[0], v = window.__view();
    const G = S.stores.GatherTask;
    const my = (id) => v.units.filter((u) => u.playerId === 0 && (!id || u.unitId === id));
    const myB = (id) => v.buildings.filter((b) => b.playerId === 0 && b.buildingId === id && b.active);
    const tc = v.buildings.find((b) => b.playerId === 0 && b.buildingId === "town_center");
    if (!tc) return;
    for (const u of my("villager")) {
      if (G.phase[u.eid] !== 0 || S.garrisonOf.has(u.eid)) continue;
      let best = null, bd = 1e18;
      for (const n of v.nodes) {
        if (n.depleted || ![0, 1, 2, 3].includes(n.resType)) continue;
        const d = (n.x - u.x) ** 2 + (n.z - u.z) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
      if (best) window.__cmd({ type: "gather", playerId: 0, eids: [u.eid], nodeEid: best.eid });
    }
    if (my("villager").length < 12 && P.foodMilli > 60000 && P.popUsed < P.popCap) window.__cmd({ type: "train", playerId: 0, buildingEid: tc.eid, unit: "villager" });
    const b = my("villager")[0];
    if (b && P.popCap - P.popUsed <= 3 && P.woodMilli > 40000) window.__cmd({ type: "build", playerId: 0, eids: [b.eid], building: "house", x: -1, y: -1 });
    if (b && myB("barracks").length === 0 && P.woodMilli > 170000 && P.age >= 1) window.__cmd({ type: "build", playerId: 0, eids: [b.eid], building: "barracks", x: -1, y: -1 });
    if (b && myB("temple").length === 0 && P.woodMilli > 120000) window.__cmd({ type: "build", playerId: 0, eids: [b.eid], building: "temple", x: -1, y: -1 });
    if (P.age === 0 && P.foodMilli > 430000 && myB("temple").length > 0 && !P.researchQueue.length) window.__cmd({ type: "research", playerId: 0, tech: "age_classical", minorGod: window.__fm[P.pantheon] });
    const bar = myB("barracks")[0];
    if (bar && P.foodMilli > 70000 && P.goldMilli > 55000 && P.popUsed < P.popCap) window.__cmd({ type: "train", playerId: 0, buildingEid: bar.eid, unit: "infantry_base" });
    const army = my().filter((u) => ["infantry"].includes(S.unitStats(u.eid).unitClass)).map((u) => u.eid);
    const raid = v.units.find((u) => u.playerId !== 0 && Math.hypot(u.x - tc.x, u.z - tc.z) < 18);
    if (raid && army.length) window.__cmd({ type: "attack_move", playerId: 0, eids: army, x: Math.round(raid.x * 1000), y: Math.round(raid.z * 1000) });
  };
});
const pantheons = await import("node:fs").then((fs) => JSON.parse(fs.readFileSync(new URL("../data/pantheons.json", import.meta.url), "utf8")).pantheons);
const fm = {};
for (const [pid, pan] of Object.entries(pantheons)) fm[pid] = pan.majors?.[0]?.minorPool?.classical?.[0];
await page.evaluate((f) => { window.__fm = f; }, fm);
// standing defenders so the synthetic raids churn combat without ending the match
await page.evaluate(() => {
  const tc = window.__view().buildings.find((b) => b.playerId === 0 && b.buildingId === "town_center");
  const eids = [];
  for (let i = 0; i < 10; i++) eids.push(window.__spawn(0, "infantry_base", tc.x - 4 + (i % 5) * 2, tc.z + 5));
  window.__cmd({ type: "stance", playerId: 0, eids, stance: 2 });
  window.__step(2);
});
const samples = [];
for (let min = 0; min < 90; min++) {
  const t0 = Date.now();
  await page.evaluate((m) => {
    window.__soak();
    // synthetic raid every minute: combat + deaths + corpses + FX churn
    const tc = window.__view().buildings.find((b) => b.playerId === 0 && b.buildingId === "town_center");
    if (tc && m > 2) {
      const eids = [];
      for (let i = 0; i < 2; i++) eids.push(window.__spawn(1, i % 2 ? "archer_base" : "infantry_base", tc.x + 8 + i, tc.z + 6));
      window.__cmd({ type: "attack", playerId: 1, eids, targetEid: -1 });
    }
    window.__step(900);
    for (let i = 0; i < 2; i++) window.__forceFrame();
  }, min);
  const s = await page.evaluate(() => ({
    tick: window.__sim.tick, winner: window.__sim.winner,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
    meshes: window.__scene.meshes.length,
    tnodes: window.__scene.transformNodes.length,
    mats: window.__scene.materials.length,
    units: window.__view().units.length,
    pop: window.__sim.players[0].popUsed,
  }));
  s.wallMs = Date.now() - t0;
  samples.push(s);
  if (min % 10 === 0) console.log(`min ${min + 1}: heap ${s.heapMB}MB meshes ${s.meshes} tnodes ${s.tnodes} mats ${s.mats} units ${s.units} wall ${s.wallMs}ms winner ${s.winner}`);
  if (s.winner >= 0) { console.log(`match ended at min ${min + 1}, winner ${s.winner} — continuing sampling post-game 5 min`); }
  if (s.winner >= 0) { console.log("unexpected early end"); break; }
}
const a = samples[Math.min(9, samples.length - 1)], z = samples[samples.length - 1];
console.log(`\nDRIFT min10→end: heap ${a.heapMB}→${z.heapMB}MB, meshes ${a.meshes}→${z.meshes}, tnodes ${a.tnodes}→${z.tnodes}, mats ${a.mats}→${z.mats}, wall ${a.wallMs}→${z.wallMs}ms`);
if (z.tnodes > a.tnodes * 3 && z.tnodes - a.tnodes > 400) console.log("FINDING: transform-node growth suggests a leak (corpses/FX?)");
if (z.mats > a.mats + 50) console.log("FINDING: material count grows unbounded");
if (z.heapMB > 0 && z.heapMB > a.heapMB * 2) console.log("FINDING: heap doubled over the soak");
console.log("pageerrors:", errs.length ? errs.join(" | ") : "none");
await browser.close();
