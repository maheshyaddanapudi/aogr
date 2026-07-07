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
      window.__rot = window.__rot ?? 0;
      const ROT = [[0, 3, 5], [1], [1], [0, 3, 5], [2], [1]];
      const tc = myB("town_center")[0];
      if (!tc) return;
      // eco basics
      for (const eid of idle) {
        const u = view.units.find((x) => x.eid === eid);
        const types = ROT[window.__rot++ % ROT.length];
        let best = null, bd = 1e18;
        for (const n of view.nodes) {
          if (n.depleted || !types.includes(n.resType)) continue;
          if (n.resType === 5) { const o = S.herdOwner.get(n.eid); if (o !== undefined && o !== 0) continue; }
          const d = (n.x - u.x) ** 2 + (n.z - u.z) ** 2;
          if (d < bd) { bd = d; best = n; }
        }
        if (best) window.__cmd({ type: "gather", playerId: 0, eids: [eid], nodeEid: best.eid });
      }
      const food = P.foodMilli / 1000, wood = P.woodMilli / 1000, gold = P.goldMilli / 1000;
      if (my("villager").length < 14 && food >= 60 && P.popUsed < P.popCap) window.__cmd({ type: "train", playerId: 0, buildingEid: tc.eid, unit: "villager" });
      // ONE construction site at a time: keep a crew on it until it stands —
      // re-issuing builds each pulse starves the builder (round-7 F8 root cause)
      const sites = view.buildings.filter((b) => b.playerId === 0 && !b.active);
      const builder = my("villager")[0];
      if (sites.length > 0) {
        const G2 = S.stores.GatherTask;
        const crewed = my("villager").some((u) => G2.phase[u.eid] === 4);
        if (!crewed && builder) window.__cmd({ type: "work_on", playerId: 0, eids: [builder.eid], buildingEid: sites[0].eid });
      } else if (builder) {
        if (P.popCap - P.popUsed <= 3 && wood >= 35) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "house", x: -1, y: -1 });
        else if (myB("temple", false).length === 0 && wood >= 110) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "temple", x: -1, y: -1 });
        else if (P.age >= 1 && myB("barracks", false).length < (obj === "wonder" ? 2 : 1) && wood >= 160) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "barracks", x: -1, y: -1 });
        else if (P.age >= 1 && myB("armory", false).length === 0 && myB("barracks").length > 0 && wood >= 160) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "armory", x: -1, y: -1 });
        else if (myB("farm", false).length < 3 && wood >= 70 && my("villager").length >= 8) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "farm", x: -1, y: -1 });
        else if (obj === "wonder" && P.age >= 2 && myB("market", false).length === 0 && wood >= 160) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "market", x: -1, y: -1 });
        else if (obj === "wonder" && P.age >= 3 && myB("wonder", false).length === 0 && food >= 1050 && wood >= 1050 && gold >= 1050 && my().filter((u) => ["infantry", "archer", "cavalry"].includes(S.unitStats(u.eid).unitClass)).length >= 14) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "wonder", x: -1, y: -1 });
        else if ((obj === "conquest" || obj === "naval") && window.__isWaterMission && myB("dock", false).length === 0 && wood >= 140) window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "dock", x: -1, y: -1 });
      }
      const FIRST = { ashen_forge: "vulkar", verdant_deep: "thalassa", auryan_dawn: "aurel", storm_concord: "zephyrion" };
      if (P.age === 0 && food >= 420 && myB("temple").length > 0 && !P.researchQueue.some((r) => r.techId === "age_classical")) {
        window.__cmd({ type: "research", playerId: 0, tech: "age_classical", minorGod: window.__firstMinor[P.pantheon] });
      }
      // an average player upgrades their line: armory techs when affordable
      if (P.age >= 1 && myB("armory").length > 0 && P.researchQueue.length === 0) {
        for (const tech of ["bronze_weapons", "bronze_mail"]) {
          if (!P.researchedTechs.includes(tech) && food >= 160 && gold >= 110) {
            window.__cmd({ type: "research", playerId: 0, tech });
            break;
          }
        }
      }
      if (obj === "wonder") {
        // age-ups REQUIRE a minor-god pick — omitting it is silently rejected
        if (P.age === 1 && food >= 850 && gold >= 550 && myB("armory").length > 0 && !P.researchQueue.some((r) => r.techId.startsWith("age_"))) window.__cmd({ type: "research", playerId: 0, tech: "age_heroic", minorGod: window.__minorPools[P.pantheon].heroic });
        if (P.age === 2 && food >= 1050 && gold >= 1050 && myB("market").length > 0 && !P.researchQueue.some((r) => r.techId.startsWith("age_"))) window.__cmd({ type: "research", playerId: 0, tech: "age_mythic", minorGod: window.__minorPools[P.pantheon].mythic });
      }
      // relic mission: hero duty
      if (obj === "relics") {
        // heroes cost FAVOR — generate it per pantheon mechanic first
        if (P.favorMilli < 6000) {
          if (P.pantheon === "auryan_dawn" && sites.length === 0 && myB("sun_altar", false).length === 0 && wood >= 110 && gold >= 60 && builder) {
            window.__cmd({ type: "build", playerId: 0, eids: [builder.eid], building: "sun_altar", x: -1, y: -1 });
          } else if (P.pantheon === "storm_concord" && myB("temple").length > 0) {
            const pv = my("villager").slice(0, 2).map((u) => u.eid);
            if (pv.length > 0) window.__cmd({ type: "pray", playerId: 0, eids: pv });
          }
        }
        const heroes = my().filter((u) => window.__sim.unitStats(u.eid).unitClass === "hero");
        const temple = myB("temple")[0];
        // retry until a hero actually EXISTS — the order is silently rejected while favor is short
        if (heroes.length === 0 && P.age >= 1 && temple && food >= 200 && P.favorMilli >= 4000 && (S.trainQueues.get(temple.eid)?.length ?? 0) === 0) {
          const heroId = { auryan_dawn: "radiant_champion", verdant_deep: "tide_seer", ashen_forge: "forgeborn", storm_concord: "sky_herald" }[P.pantheon];
          window.__cmd({ type: "train", playerId: 0, buildingEid: temple.eid, unit: heroId });
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
      for (const bar of myB("barracks")) {
        if (P.age >= 1 && food >= 60 && gold >= 50 && P.popUsed < P.popCap && (S.trainQueues.get(bar.eid)?.length ?? 0) < 2) {
          window.__cmd({ type: "train", playerId: 0, buildingEid: bar.eid, unit: "infantry_base" });
        }
      }
      const army = my().filter((u) => ["infantry", "archer", "cavalry"].includes(window.__sim.unitStats(u.eid).unitClass)).map((u) => u.eid);
      // water missions: a small picket of galleys meets seaborne raiders
      if (window.__isWaterMission) {
        const dock = myB("dock")[0];
        if (dock && wood >= 130 && gold >= 70 && my("war_galley").length < 2 && P.age >= 1) {
          window.__cmd({ type: "train", playerId: 0, buildingEid: dock.eid, unit: "war_galley" });
        }
      }
      const intruders = view.units.filter((u) => u.playerId !== 0 && Math.hypot(u.x - tc.x, u.z - tc.z) < 20);
      if (intruders.length > 0 && army.length > 0) {
        window.__cmd({ type: "attack_move", playerId: 0, eids: army, x: Math.round(intruders[0].x * 1000), y: Math.round(intruders[0].z * 1000) });
        if (!window.__camp.garrisoned) {
          const vs = my("villager").slice(0, 3).map((u) => u.eid);
          if (vs.length > 0) { window.__cmd({ type: "garrison", playerId: 0, eids: vs, buildingEid: tc.eid }); window.__camp.garrisoned = true; }
        }
      } else if (window.__camp.garrisoned && intruders.length === 0) {
        window.__cmd({ type: "ungarrison", playerId: 0, buildingEid: tc.eid });
        window.__camp.garrisoned = false;
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
  const pools = {};
  for (const [pid, pan] of Object.entries(pantheonsData)) {
    fm[pid] = pan.majors?.[0]?.minorPool?.classical?.[0];
    pools[pid] = {
      heroic: pan.majors?.[0]?.minorPool?.heroic?.[0],
      mythic: pan.majors?.[0]?.minorPool?.mythic?.[0],
    };
  }
  await page.evaluate(([f, water, mp]) => { window.__firstMinor = f; window.__isWaterMission = water; window.__minorPools = mp; }, [fm, ms.mapType !== "inland", pools]);
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
  // the objective checker runs on a 500ms interval — give it a beat to write progress
  if (result === "WIN") await page.waitForFunction((want) => Number(localStorage.getItem("aogr-campaign") ?? 0) >= want, mi + 1, { timeout: 5000 }).catch(() => {});
  const progressAfter = await page.evaluate(() => Number(localStorage.getItem("aogr-campaign") ?? 0));
  if (result === "WIN" && progressAfter < mi + 1) findings.push(`M${mi + 1}: WIN did not advance campaign progress (${progressAfter})`);
  if (errs.length) findings.push(`M${mi + 1}: pageerrors: ${errs.slice(0, 2).join(" | ")}`);
  console.log(`■ M${mi + 1} "${ms.title}" [${ms.objective.type}/${ms.aiDifficulty}]: ${result} @min ${Math.trunc(lastTick / 900)} | progress→${progressAfter}${errs.length ? " | ERRS:" + errs.length : ""}`);
  await page.context().close();
  if (result !== "WIN") { findings.push(`M${mi + 1}: not completed (${result}) — campaign gate for later missions`); break; }
}
console.log("\nFINDINGS:", findings.length ? findings.join("\n  - ") : "none");
await browser.close();
