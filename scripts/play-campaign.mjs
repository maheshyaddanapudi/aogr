/**
 * Full campaign playthrough: missions 1→6 in order, objective-aware player,
 * verifying each objective completes and progress advances.
 *   node scripts/play-campaign.mjs [startMission]
 */
import { chromium } from "../node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const missions = JSON.parse(readFileSync(new URL("../data/campaign.json", import.meta.url), "utf8")).missions;
const start = Number(process.argv[2] ?? 0);
const MAX_MIN = 40;

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const findings = [];
for (let mi = start; mi < missions.length; mi++) {
  const ms = missions[mi];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 150)));
  await page.goto("http://localhost:4173/aogr/", { waitUntil: "domcontentloaded" });
  await page.evaluate((i) => localStorage.setItem("aogr-campaign", String(i)), mi);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mission-chip", { timeout: 60000 });
  // the chip for this mission must be unlocked
  const chip = await page.evaluate((i) => {
    const c = document.querySelectorAll(".mission-chip")[i];
    return c ? { text: c.textContent, disabled: c.disabled } : null;
  }, mi);
  if (!chip || chip.disabled) {
    findings.push(`M${mi + 1}: mission chip locked/missing despite progress=${mi}`);
    console.log(`■ M${mi + 1} ${ms.title}: BLOCKED (chip locked)`);
    await page.context().close();
    continue;
  }
  await page.evaluate((i) => document.querySelectorAll(".mission-chip")[i].click(), mi);
  await page.waitForFunction(() => window.__sim !== undefined, null, { timeout: 240000 });
  const hasStory = await page.waitForSelector("#mission-begin", { timeout: 30000 }).then(() => true).catch(() => false);
  if (!hasStory) findings.push(`M${mi + 1}: story overlay missing`);
  else await page.click("#mission-begin");
  // pause the live loop and drive via __step for speed
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".age-wrap button")).find((b) => b.textContent === "⏸");
    btn?.click();
  });
  // objective-aware macro (lean)
  await page.evaluate(() => {
    window.__camp = { heroTrained: false };
    window.__cmacro = (obj) => {
      const S = window.__sim;
      const P = S.players[0];
      const view = window.__view();
      const my = (id) => view.units.filter((u) => u.playerId === 0 && (!id || u.unitId === id));
      const myB = (id, act = true) => view.buildings.filter((b) => b.playerId === 0 && (!id || b.buildingId === id) && (!act || b.active));
      const G = S.stores.GatherTask;
      const idle = my("villager").filter((u) => G.phase[u.eid] === 0).map((u) => u.eid);
      const tc = myB("town_center")[0];
      if (!tc) return;
      // eco basics
      for (const eid of idle) {
        const u = view.units.find((x) => x.eid === eid);
        let best = null, bd = 1e18;
        for (const n of view.nodes) {
          if (n.depleted || ![0, 1, 2, 3, 5].includes(n.resType)) continue;
          if (n.resType === 5) { const o = S.herdOwner.get(n.eid); if (o !== undefined && o !== 0) continue; }
          const d = (n.x - u.x) ** 2 + (n.z - u.z) ** 2;
          if (d < bd) { bd = d; best = n; }
        }
        if (best) window.__cmd({ type: "gather", playerId: 0, eids: [eid], nodeEid: best.eid });
      }
      const food = P.foodMilli / 1000, wood = P.woodMilli / 1000, gold = P.goldMilli / 1000;
      if (my("villager").length < 14 && food >= 60 && P.popUsed < P.popCap) window.__cmd({ type: "train", playerId: 0, buildingEid: tc.eid, unit: "villager" });
      const builder = my("villager")[0];
      if (builder) {
        if (P.popCap - P.popUsed <= 3 && wood >= 35) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "house", x: -1, y: -1 });
        else if (myB("temple", false).length === 0 && wood >= 110) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "temple", x: -1, y: -1 });
        else if (P.age >= 1 && myB("barracks", false).length === 0 && wood >= 160) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "barracks", x: -1, y: -1 });
        else if (P.age >= 1 && myB("armory", false).length === 0 && myB("barracks").length > 0 && wood >= 160) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "armory", x: -1, y: -1 });
        else if (myB("farm", false).length < 3 && wood >= 70 && my("villager").length >= 8) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "farm", x: -1, y: -1 });
        else if (obj === "wonder" && P.age >= 2 && myB("market", false).length === 0 && wood >= 160) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "market", x: -1, y: -1 });
        else if (obj === "wonder" && P.age >= 3 && myB("wonder", false).length === 0 && food >= 1050 && wood >= 1050 && gold >= 1050) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "wonder", x: -1, y: -1 });
        else if ((obj === "conquest" || obj === "naval") && window.__isWaterMission && myB("dock", false).length === 0 && wood >= 140) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "dock", x: -1, y: -1 });
      }
      const FIRST = { ashen_forge: "vulkar", verdant_deep: "thalassa", auryan_dawn: "aurel", storm_concord: "zephyrion" };
      if (P.age === 0 && food >= 420 && myB("temple").length > 0 && !P.researchQueue.some((r) => r.techId === "age_classical")) {
        window.__cmd({ type: "research", playerId: 0, tech: "age_classical", minorGod: window.__firstMinor[P.pantheon] });
      }
      if (obj === "wonder") {
        if (P.age === 1 && food >= 850 && gold >= 550 && myB("armory").length > 0 && !P.researchQueue.some((r) => r.techId.startsWith("age_"))) window.__cmd({ type: "research", playerId: 0, tech: "age_heroic" });
        if (P.age === 2 && food >= 1050 && gold >= 1050 && myB("market").length > 0 && !P.researchQueue.some((r) => r.techId.startsWith("age_"))) window.__cmd({ type: "research", playerId: 0, tech: "age_mythic" });
      }
      // relic mission: hero duty
      if (obj === "relics") {
        const heroes = my().filter((u) => window.__sim.unitStats(u.eid).unitClass === "hero");
        if (heroes.length === 0 && !window.__camp.heroTrained && P.age >= 1 && myB("temple").length > 0 && food >= 200) {
          const heroId = { auryan_dawn: "radiant_champion", verdant_deep: "tide_seer", ashen_forge: "forgeborn", storm_concord: "sky_herald" }[P.pantheon];
          window.__cmd({ type: "train", playerId: 0, buildingEid: myB("temple")[0].eid, unit: heroId });
          window.__camp.heroTrained = true;
        }
        for (const h of heroes) {
          if (S.relicHolder.get(h.eid)) {
            const t = myB("temple")[0];
            if (t) window.__cmd({ type: "move", playerId: 0, eids: [h.eid], x: Math.round(t.x * 1000), y: Math.round(t.z * 1000) });
          } else {
            const relics = view.nodes.filter((n) => n.resType === 4 && !n.depleted);
            if (relics.length > 0) window.__cmd({ type: "move", playerId: 0, eids: [h.eid], x: Math.round(relics[0].x * 1000), y: Math.round(relics[0].z * 1000) });
          }
        }
      }
      // military + defense/attack
      const bar = myB("barracks")[0];
      if (bar && P.age >= 1 && food >= 60 && gold >= 50 && P.popUsed < P.popCap) window.__cmd({ type: "train", playerId: 0, buildingEid: bar.eid, unit: "infantry_base" });
      const army = my().filter((u) => ["infantry", "archer", "cavalry"].includes(window.__sim.unitStats(u.eid).unitClass)).map((u) => u.eid);
      const intruders = view.units.filter((u) => u.playerId !== 0 && Math.hypot(u.x - tc.x, u.z - tc.z) < 20);
      if (intruders.length > 0 && army.length > 0) {
        window.__cmd({ type: "attack_move", playerId: 0, eids: army, x: Math.round(intruders[0].x * 1000), y: Math.round(intruders[0].z * 1000) });
      } else if ((obj === "conquest" || obj === "naval") && army.length >= 12) {
        const foes = view.buildings.filter((b) => b.playerId !== 0 && b.buildingId === "town_center");
        if (foes.length > 0) {
          const weakest = foes.sort((a, b) => a.hpFrac - b.hpFrac)[0];
          window.__cmd({ type: "attack_move", playerId: 0, eids: army, x: Math.round(weakest.x * 1000), y: Math.round(weakest.z * 1000) });
        }
      }
    };
  });
  const FIRST_MINOR = { ashen_forge: "ignar", verdant_deep: "nerida", auryan_dawn: "solath", storm_concord: "zephyrion" };
  // real first minors come from the data — inject them
  const pantheonsData = JSON.parse(readFileSync(new URL("../data/pantheons.json", import.meta.url), "utf8")).pantheons;
  const fm = {};
  for (const [pid, pan] of Object.entries(pantheonsData)) fm[pid] = pan.majors?.[0]?.minorPool?.classical?.[0];
  await page.evaluate(([f, water]) => { window.__firstMinor = f; window.__isWaterMission = water; }, [fm, ms.mapType !== "inland"]);
  void FIRST_MINOR;

  const objType = ms.objective.type === "conquest" && ms.mapType === "archipelago" ? "naval" : ms.objective.type;
  let result = "timeout";
  let lastTick = -1;
  for (let pulse = 0; pulse < (MAX_MIN * 900) / 75; pulse++) {
    await page.evaluate((o) => { window.__cmacro(o); window.__step(75); }, objType);
    const st = await page.evaluate(() => ({ tick: window.__sim.tick, winner: window.__sim.winner, over: !!document.querySelector(".age-overlay h1"),
      pop: window.__sim.players[0].popUsed, age: window.__sim.players[0].age,
      army: window.__view().units.filter((u) => u.playerId === 0 && ["infantry","archer","cavalry"].includes(window.__sim.unitStats(u.eid).unitClass)).length,
      foeTcHp: (window.__view().buildings.find((b) => b.playerId !== 0 && b.buildingId === "town_center") || { hpFrac: -1 }).hpFrac }));
    const mnow = Math.trunc(st.tick / 900);
    if (mnow % 5 === 0 && mnow > 0 && st.tick % 900 < 76) console.log(`  [M${mi + 1}] min ${mnow}: pop ${st.pop} age ${st.age} army ${st.army} foeTC ${st.foeTcHp.toFixed(2)}`);
    if (st.tick === lastTick) { findings.push(`M${mi + 1}: SIM HANG`); break; }
    lastTick = st.tick;
    if (st.winner === 0) { result = "WIN"; break; }
    if (st.winner > 0) { result = "LOSS"; break; }
  }
  const progressAfter = await page.evaluate(() => Number(localStorage.getItem("aogr-campaign") ?? 0));
  if (result === "WIN" && progressAfter < mi + 1) findings.push(`M${mi + 1}: WIN did not advance campaign progress (${progressAfter})`);
  if (errs.length) findings.push(`M${mi + 1}: pageerrors: ${errs.slice(0, 2).join(" | ")}`);
  console.log(`■ M${mi + 1} "${ms.title}" [${ms.objective.type}/${ms.aiDifficulty}]: ${result} @min ${Math.trunc(lastTick / 900)} | progress→${progressAfter}${errs.length ? " | ERRS:" + errs.length : ""}`);
  await page.context().close();
  if (result !== "WIN") { findings.push(`M${mi + 1}: not completed (${result}) — campaign gate for later missions`); break; }
}
console.log("\nFINDINGS:", findings.length ? findings.join("\n  - ") : "none");
await browser.close();
