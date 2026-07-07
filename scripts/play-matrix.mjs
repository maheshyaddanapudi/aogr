/**
 * Manual play-matrix: a scripted human plays full matches in the real browser
 * build against live AI — {1v1, FFA} × all five difficulties — with per-pulse
 * invariant probes. Wins and losses are both fine; crashes, hangs, stalls, and
 * invariant violations are bugs.
 *
 *   node scripts/play-matrix.mjs [cellIndex...]   (default: all 10)
 *
 * Requires `npx vite preview --port 4173` serving a fresh build.
 */
import { chromium } from "../node_modules/playwright/index.mjs";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

// minor god → god power id, straight from the data files
const pantheons = JSON.parse(readFileSync(new URL("../data/pantheons.json", import.meta.url), "utf8")).pantheons;
const FIRST_MINOR = {}; // pantheon → first classical minor of the default major
for (const [pid, pan] of Object.entries(pantheons)) {
  FIRST_MINOR[pid] = pan.majors?.[0]?.minorPool?.classical?.[0];
}
const MINOR_POWER = {};
for (const pan of Object.values(pantheons)) {
  for (const tier of Object.values(pan.minors ?? {})) {
    for (const m of Array.isArray(tier) ? tier : []) MINOR_POWER[m.id] = m.grants?.power;
  }
  if (Array.isArray(pan.minors)) for (const m of pan.minors) MINOR_POWER[m.id] = m.grants?.power;
}

const CELLS = [
  { mode: "1v1", ai: "easiest", opp: 1, map: "island", pantheon: "ashen_forge", seed: 1101 },
  { mode: "1v1", ai: "easy", opp: 1, map: "inland", pantheon: "verdant_deep", seed: 1202 },
  { mode: "1v1", ai: "medium", opp: 1, map: "island", pantheon: "auryan_dawn", seed: 1303 },
  { mode: "1v1", ai: "hard", opp: 1, map: "archipelago", pantheon: "storm_concord", seed: 1404 },
  { mode: "1v1", ai: "titan", opp: 1, map: "island", pantheon: "ashen_forge", seed: 1505 },
  { mode: "FFA", ai: "easiest", opp: 2, map: "inland", pantheon: "storm_concord", seed: 2101 },
  { mode: "FFA", ai: "easy", opp: 2, map: "island", pantheon: "auryan_dawn", seed: 2202 },
  { mode: "FFA", ai: "medium", opp: 2, map: "island", pantheon: "verdant_deep", seed: 2303 },
  { mode: "FFA", ai: "hard", opp: 2, map: "inland", pantheon: "ashen_forge", seed: 2404 },
  { mode: "FFA", ai: "titan", opp: 2, map: "island", pantheon: "storm_concord", seed: 2505 },
];

const MAX_GAME_MIN = 40;
const wanted = process.argv.slice(2).map(Number);
const cells = wanted.length > 0 ? wanted.map((i) => ({ i, ...CELLS[i] })) : CELLS.map((c, i) => ({ i, ...c }));

const MACRO = `
window.__anomalies = [];
window.__log = [];
const A = (msg) => { if (!window.__anomalies.includes(msg)) window.__anomalies.push(msg); };
const S = () => window.__sim;
const P = (i) => S().players[i];
window.__m = { raided: false, garrisoned: false, casts: 0, hunted: false, dockBuilt: false, boats: 0,
  mender: false, attackMoves: 0, aiBuiltBy6: {}, result: "?", aiEverAttacked: false };
const myUnits = (id) => window.__view().units.filter((u) => u.playerId === 0 && (!id || u.unitId === id));
const myB = (id, act = true) => window.__view().buildings.filter((b) => b.playerId === 0 && (!id || b.buildingId === id) && (!act || b.active));
const idleVills = () => {
  const G = S().stores.GatherTask;
  return myUnits("villager").filter((u) => G.phase[u.eid] === 0 && !S().garrisonOf.has(u.eid)).map((u) => u.eid);
};
const nearestNode = (types, fx, fz) => {
  let best = null, bd = 1e18;
  for (const n of window.__view().nodes) {
    if (n.depleted || !types.includes(n.resType)) continue;
    if (n.resType === 5) { const o = S().herdOwner.get(n.eid); if (o !== undefined && o !== 0) continue; }
    const d = (n.x - fx) ** 2 + (n.z - fz) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
};
const tc = () => window.__view().buildings.find((b) => b.playerId === 0 && b.buildingId === "town_center");
let rot = 0;
const ROT = [[0, 3, 5], [1], [0, 3, 5], [2], [1], [0, 3, 5]]; // food-ish, wood, gold rotation
let buildCd = 0;
window.__macro = (isWaterMap) => {
  const t = tc();
  if (!t) return;
  const p = P(0);
  const food = p.foodMilli / 1000, wood = p.woodMilli / 1000, gold = p.goldMilli / 1000;
  // task idle villagers (hunt + herd count as food)
  for (const eid of idleVills()) {
    const u = window.__view().units.find((x) => x.eid === eid);
    const n = nearestNode(ROT[rot++ % ROT.length], u.x, u.z);
    if (n) {
      window.__cmd({ type: "gather", playerId: 0, eids: [eid], nodeEid: n.eid });
      if (n.resType === 3 || n.resType === 5) window.__m.hunted = true;
    }
  }
  // train villagers to 15
  if (myUnits("villager").length < 15 && food >= 60 && p.popUsed < p.popCap) {
    window.__cmd({ type: "train", playerId: 0, buildingEid: t.eid, unit: "villager" });
  }
  if (buildCd > 0) buildCd--;
  const builder = myUnits("villager")[0];
  if (builder && buildCd === 0) {
    const want = [];
    if (p.popCap - p.popUsed <= 3 && wood >= 35) want.push("house");
    if (myB("temple", false).length === 0 && wood >= 110) want.push("temple");
    if (p.age >= 1 && myB("barracks", false).length === 0 && wood >= 160) want.push("barracks");
    if (p.age >= 1 && myB("barracks").length > 0 && myB("armory", false).length === 0 && wood >= 160) want.push("armory");
    if (myB("farm", false).length < 2 && wood >= 70 && myUnits("villager").length >= 8) want.push("farm");
    if (isWaterMap && p.age >= 0 && myB("dock", false).length === 0 && wood >= 140 && myUnits("villager").length >= 6) want.push("dock");
    if (want.length > 0) {
      window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: want[0], x: -1, y: -1 });
      buildCd = 3;
    }
  }
  // dock has no auto-site (-1 goes near TC which may be inland) — handled by sim findBuildSite + coastal rule; if it failed 3 times, note it
  // age up
  if (p.age === 0 && food >= 420 && myB("temple").length > 0 && !p.researchQueue.some((r) => r.techId === "age_classical")) {
    window.__cmd({ type: "research", playerId: 0, tech: "age_classical", minorGod: window.__firstMinor[p.pantheon] });
    window.__log.push("min " + Math.trunc(S().tick / 900) + ": CLASSICAL research");
  }
  // mender once
  if (!window.__m.mender && p.age >= 1 && myB("temple").length > 0 && food >= 70 && gold >= 45) {
    window.__cmd({ type: "train", playerId: 0, buildingEid: myB("temple")[0].eid, unit: "mender" });
    window.__m.mender = true;
  }
  // fishing boats on water maps
  if (isWaterMap && myB("dock").length > 0 && window.__m.boats < 2 && wood >= 80) {
    window.__cmd({ type: "train", playerId: 0, buildingEid: myB("dock")[0].eid, unit: "fishing_boat" });
    window.__m.boats++;
    window.__m.dockBuilt = true;
  }
  const idleBoats = myUnits("fishing_boat").filter((u) => S().stores.GatherTask.phase[u.eid] === 0);
  for (const b of idleBoats) {
    const n = nearestNode([6], b.x, b.z);
    if (n) window.__cmd({ type: "gather", playerId: 0, eids: [b.eid], nodeEid: n.eid });
  }
  // military
  const bar = myB("barracks")[0];
  if (bar && p.age >= 1 && food >= 60 && gold >= 50 && p.popUsed < p.popCap) {
    window.__cmd({ type: "train", playerId: 0, buildingEid: bar.eid, unit: "infantry_base" });
  }
  const army = myUnits().filter((u) => ["infantry", "archer", "cavalry"].includes(S().unitStats(u.eid).unitClass) && !S().garrisonOf.has(u.eid)).map((u) => u.eid);
  // god power at the strongest enemy once unlocked
  if (p.minorGods.length > 0 && p.favorMilli > 60000 && window.__m.casts < 3) {
    const foes = window.__view().buildings.filter((b) => b.playerId !== 0 && b.buildingId === "town_center");
    if (foes.length > 0) {
      const power = window.__minorPowerMap[p.minorGods[0]] ?? null;
      if (power) {
        window.__cmd({ type: "cast_power", playerId: 0, power, x: Math.round(foes[0].x * 1000), y: Math.round(foes[0].z * 1000) });
        window.__m.casts++;
      }
    }
  }
  // defense: raid → garrison 2 villagers; clear → ungarrison
  const intruders = window.__view().units.filter((u) => u.playerId !== 0 && Math.hypot(u.x - t.x, u.z - t.z) < 20);
  if (intruders.length > 0) {
    window.__m.raided = true;
    window.__m.aiEverAttacked = true;
    if (!window.__m.garrisoned) {
      const vs = myUnits("villager").slice(0, 2).map((u) => u.eid);
      if (vs.length > 0) {
        window.__cmd({ type: "garrison", playerId: 0, eids: vs, buildingEid: t.eid });
        window.__m.garrisoned = true;
      }
    }
    if (army.length > 0) {
      window.__cmd({ type: "attack_move", playerId: 0, eids: army, x: Math.round(intruders[0].x * 1000), y: Math.round(intruders[0].z * 1000) });
    }
  } else if (window.__m.garrisoned && (S().garrisons.get(t.eid) ?? []).length > 0) {
    window.__cmd({ type: "ungarrison", playerId: 0, buildingEid: t.eid });
    window.__m.garrisoned = false;
  } else if (army.length >= 12) {
    // assault the WEAKEST enemy throne, battle order, attack-move
    const foes = window.__view().buildings.filter((b) => b.playerId !== 0 && b.buildingId === "town_center");
    if (foes.length > 0) {
      const weakest = foes.sort((a, b2) => a.hpFrac - b2.hpFrac)[0];
      window.__cmd({ type: "move", playerId: 0, eids: army, x: Math.round(weakest.x * 1000), y: Math.round((weakest.z + 6) * 1000), formation: 2 });
      window.__cmd({ type: "attack_move", playerId: 0, eids: army, x: Math.round(weakest.x * 1000), y: Math.round(weakest.z * 1000) });
      window.__m.attackMoves++;
    }
  }
  // ── invariants ──
  for (let i = 0; i < S().players.length; i++) {
    const pl = P(i);
    for (const k of ["foodMilli", "woodMilli", "goldMilli", "favorMilli"]) {
      if (!Number.isFinite(pl[k])) A("P" + i + " " + k + " not finite");
      if (pl[k] < 0) A("P" + i + " " + k + " negative: " + pl[k]);
    }
    if (pl.popUsed < 0 || pl.popUsed > 300) A("P" + i + " popUsed out of range: " + pl.popUsed);
  }
  if (![-1, 0, 1, 2].includes(S().winner)) A("winner out of range: " + S().winner);
  for (const u of window.__view().units) {
    const st = S().unitStats(u.eid);
    const tx = Math.trunc(u.x), ty = Math.trunc(u.z);
    if (st.naval) {
      if (!window.__isWater(tx, ty)) A("ship on land: " + st.id + " @" + tx + "," + ty);
    } else if (!S().garrisonOf.has(u.eid)) {
      if (!S().navGrid.passable[ty * S().navGrid.size + tx] && !window.__isWater(tx, ty)) {
        // standing inside a blocked tile is only legal momentarily during placement nudges
        A("land unit on impassable tile: " + st.id + " @" + tx + "," + ty);
      }
    }
  }
  for (const [beid, members] of S().garrisons) {
    for (const m2 of members) if (S().garrisonOf.get(m2) !== beid) A("garrison map inconsistent for " + m2);
  }
  // herd leash
  for (const [heid, home] of S().herdHome) {
    const hp = { x: S().stores.Position.x[heid], y: S().stores.Position.y[heid] };
    if (Math.abs(hp.x - home.x) > 9000 || Math.abs(hp.y - home.y) > 9000) A("herd escaped its leash");
  }
};
`;

const results = [];
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const cell of cells) {
  try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("ERR_CERT")) pageErrors.push("console: " + m.text().slice(0, 160)); });
  const url = `http://localhost:4173/aogr/?paused&seed=${cell.seed}&ai=${cell.ai}&opp=${cell.opp}&map=${cell.map}&pantheon=${cell.pantheon}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__sim !== undefined, null, { timeout: 240000 });
  await page.evaluate(MACRO);
  await page.evaluate(([minorPowerMap, firstMinor]) => {
    window.__minorPowerMap = minorPowerMap;
    window.__firstMinor = firstMinor;
    window.__isWater = (tx, ty) => {
      const t = window.__sim.terrain;
      const verts = t.size + 1;
      if (tx < 0 || ty < 0 || tx >= t.size || ty >= t.size) return false;
      return t.heights[ty * verts + tx] < t.waterLevelFp;
    };
  }, [MINOR_POWER, FIRST_MINOR]);
  const isWaterMap = cell.map !== "inland";
  let lastTick = -1;
  let hung = false;
  const start = Date.now();
  let statusLines = [];
  for (let pulse = 0; pulse < (MAX_GAME_MIN * 900) / 75; pulse++) {
    await page.evaluate((w) => { window.__macro(w); window.__step(75); }, isWaterMap);
    const st = await page.evaluate(() => ({
      tick: window.__sim.tick, winner: window.__sim.winner,
      pop: window.__sim.players[0].popUsed,
      age: window.__sim.players[0].age,
      anomalies: window.__anomalies.length,
      aiB: window.__sim.players.map((_, i) => window.__view().buildings.filter((b) => b.playerId === i).length),
    }));
    if (st.tick === lastTick) { hung = true; break; }
    lastTick = st.tick;
    const min = Math.trunc(st.tick / 900);
    if (min % 5 === 0 && min > 0 && !statusLines.includes(min)) {
      statusLines.push(min);
      console.log(`  [${cell.mode}/${cell.ai}] min ${min}: pop ${st.pop}, age ${st.age}, anomalies ${st.anomalies}`);
    }
    // liveness snapshot at ~min 6: every AI must have started building by then
    if (st.tick >= 6 * 900 && !cell._livenessChecked) {
      cell._livenessChecked = true;
      for (let i = 1; i < st.aiB.length; i++) {
        if (st.aiB[i] <= 1) await page.evaluate((n) => window.__anomalies.push(n), `AI p${i} (${cell.ai}) inactive at min 6`);
      }
    }
    if (st.winner >= 0) break;
    if (Date.now() - start > 8 * 60 * 1000) break; // wall-clock guard per match
  }
  const fin = await page.evaluate(() => ({
    tick: window.__sim.tick, winner: window.__sim.winner,
    anomalies: window.__anomalies, m: window.__m,
    aiB: window.__sim.players.map((_, i) => window.__view().buildings.filter((b) => b.playerId === i).length),
  }));
  // (liveness is judged at min 6 during play — end-state counts conflate defeat with inactivity)
  if (hung) fin.anomalies.push("SIM HANG: tick stopped advancing");
  if (pageErrors.length) fin.anomalies.push(...pageErrors.map((e) => "pageerror: " + e));
  if (fin.winner < 0 && fin.tick >= MAX_GAME_MIN * 900 - 75 && !fin.m.aiEverAttacked) {
    fin.anomalies.push("timeout with NO enemy aggression ever (possible dead AI)");
  }
  const result = fin.winner === 0 ? "WIN" : fin.winner > 0 ? "LOSS" : "timeout";
  results.push({
    cell: cell.i, mode: cell.mode, ai: cell.ai, map: cell.map, pantheon: cell.pantheon, seed: cell.seed,
    result, gameMin: Math.trunc(fin.tick / 900), anomalies: fin.anomalies,
    exercised: { raided: fin.m.raided, garrisoned: fin.m.garrisoned || fin.m.raided, hunted: fin.m.hunted, dock: fin.m.dockBuilt, attackMoves: fin.m.attackMoves },
  });
  console.log(`■ cell ${cell.i} ${cell.mode}/${cell.ai}/${cell.map}: ${result} @min ${Math.trunc(fin.tick / 900)} | anomalies: ${fin.anomalies.length ? fin.anomalies.join(" ;; ") : "none"}`);
  await page.context().close();
  } catch (err) {
    results.push({ cell: cell.i, mode: cell.mode, ai: cell.ai, map: cell.map, pantheon: cell.pantheon, seed: cell.seed,
      result: "CRASH", gameMin: 0, anomalies: ["runner: " + String(err).slice(0, 200)] });
    console.log(`■ cell ${cell.i} ${cell.mode}/${cell.ai}/${cell.map}: CRASH — ${String(err).slice(0, 160)}`);
  }
}
await browser.close();

const reportPath = "/tmp/matrix-report.json";
const prev = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : [];
const merged = [...prev.filter((r) => !results.some((n) => n.cell === r.cell)), ...results].sort((a, b) => a.cell - b.cell);
writeFileSync(reportPath, JSON.stringify(merged, null, 1));
console.log(`\nreport: ${reportPath} (${merged.length} cells recorded)`);
