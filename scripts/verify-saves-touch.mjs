/**
 * Round-9 E2E: (1) resumed matches keep their AI difficulty, (2) mid-mission
 * save → menu → "Continue mission" resumes AS the mission, (3) touch taps
 * order a boat onto open water and board a transport (real pointer events).
 *   node scripts/verify-saves-touch.mjs
 */
import { chromium } from "../node_modules/playwright/index.mjs";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };

// ── 1: titan save resumes as titan ──
{
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/aogr/?paused&seed=777001&ai=titan", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__sim !== undefined, null, { timeout: 240000 });
  await page.evaluate(() => window.__step(150));
  await page.click("button.save-btn:has-text('Save')");
  await page.waitForFunction(() => document.querySelector(".save-btn")?.textContent?.includes("✓"), null, { timeout: 10000 }).catch(() => {});
  await page.goto("http://localhost:4173/aogr/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#m-continue:not([disabled])", { timeout: 30000 });
  await page.click("#m-continue");
  await page.waitForFunction(() => window.__sim !== undefined && window.__aiDifficulty !== undefined, null, { timeout: 240000 });
  const st = await page.evaluate(() => ({ ai: window.__aiDifficulty, tick: window.__sim.tick }));
  check("resumed titan match keeps titan AI", st.ai === "titan", `ai=${st.ai}, tick=${st.tick}`);
  check("resume restores mid-match tick", st.tick >= 150, `tick=${st.tick}`);
  await page.close();
}

// ── 2: mid-mission save resumes AS the mission (campaign slot) ──
{
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/aogr/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("aogr-campaign", "1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mission-chip", { timeout: 60000 });
  await page.evaluate(() => document.querySelectorAll(".mission-chip")[1].click());
  await page.waitForFunction(() => window.__sim !== undefined, null, { timeout: 240000 });
  await page.click("#mission-begin");
  await page.waitForFunction(() => window.__sim.tick > 30, null, { timeout: 60000 });
  await page.click("button.save-btn:has-text('Save')");
  await page.waitForFunction(() => document.querySelector(".save-btn")?.textContent?.includes("✓"), null, { timeout: 10000 }).catch(() => {});
  await page.goto("http://localhost:4173/aogr/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#m-continue-camp:not([disabled])", { timeout: 30000 });
  await page.click("#m-continue-camp");
  await page.waitForFunction(() => window.__sim !== undefined, null, { timeout: 240000 });
  const st = await page.evaluate(() => ({
    tick: window.__sim.tick,
    storyTitle: document.querySelector(".age-overlay h1")?.textContent ?? null,
  }));
  check("campaign slot resumes mid-mission (tick preserved)", st.tick > 30, `tick=${st.tick}`);
  check("mission context re-armed (story overlay shows the mission)", (st.storyTitle ?? "").includes("Grain"), `title=${st.storyTitle}`);
  // skirmish slot must be untouched by the mission save
  await page.goto("http://localhost:4173/aogr/", { waitUntil: "domcontentloaded" });
  const bothSlots = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 800));
    return {
      skirmish: !document.querySelector("#m-continue")?.disabled,
      campaign: !document.querySelector("#m-continue-camp")?.disabled,
    };
  });
  check("both save slots coexist", bothSlots.skirmish && bothSlots.campaign, JSON.stringify(bothSlots));
  await page.close();
}

// ── 3: touch orders — boat to open water + boarding a transport ──
{
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/aogr/?paused&seed=1101&ai=off", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__sim !== undefined && window.__scene !== undefined, null, { timeout: 240000 });
  await page.evaluate(() => { window.__forceFrame?.(); });
  const setup = await page.evaluate(() => {
    const S = window.__sim;
    const { Position } = S.stores;
    const tc = S.players[0].townCenterEid;
    // spawn a boat + a barge on the nearest water, an infantry ashore
    const t = { x: Math.trunc(Position.x[tc] / 1000), y: Math.trunc(Position.y[tc] / 1000) };
    const isWater = (tx, ty) => { const T = S.terrain; const v = T.size + 1; return T.heights[ty * v + tx] < T.waterLevelFp; };
    let w = null;
    for (let r = 1; r < 60 && !w; r++) for (let dy = -r; dy <= r && !w; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (isWater(t.x + dx, t.y + dy)) { w = { x: t.x + dx, y: t.y + dy }; break; }
    }
    const boat = window.__spawn(0, "fishing_boat", w.x + 0.5, w.y + 0.5);
    const barge = window.__spawn(0, "transport_barge", w.x + 1.5, w.y + 0.5);
    const inf = window.__spawn(0, "infantry_base", t.x + 2.5, t.y + 0.5);
    window.__step(2);
    window.__forceFrame?.();
    return { boat, barge, inf, waterTile: w };
  });
  // find a screen pixel over open water via terrain picks
  const waterPx = await page.evaluate(() => {
    const S = window.__sim;
    const isWater = (tx, ty) => { const T = S.terrain; const v = T.size + 1; return T.heights[ty * v + tx] < T.waterLevelFp; };
    for (let sy = 100; sy < 700; sy += 40) for (let sx = 100; sx < 1200; sx += 40) {
      const p = window.__scene.pick(sx, sy, (m) => m.name === "terrain");
      if (p?.pickedPoint && isWater(Math.trunc(p.pickedPoint.x), Math.trunc(p.pickedPoint.z))) return { sx, sy, wx: p.pickedPoint.x, wz: p.pickedPoint.z };
    }
    return null;
  });
  check("a screen pixel over water picks a terrain point", waterPx !== null, JSON.stringify(waterPx));
  if (waterPx) {
    // select the boat programmatically, then TOUCH-tap the water pixel
    await page.evaluate((boat) => { window.__selection.selected.clear(); window.__selection.selected.add(boat); }, setup.boat);
    await page.touchscreen.tap(waterPx.sx, waterPx.sy);
    await page.evaluate(() => window.__step(3));
    const move = await page.evaluate((boat) => {
      const { MoveState } = window.__sim.stores;
      return { active: MoveState.active[boat], tx: MoveState.targetX[boat], ty: MoveState.targetY[boat] };
    }, setup.boat);
    const targetIsWater = await page.evaluate(([x, y]) => {
      const S = window.__sim; const T = S.terrain; const v = T.size + 1;
      return T.heights[Math.trunc(y / 1000) * v + Math.trunc(x / 1000)] < T.waterLevelFp;
    }, [move.tx, move.ty]);
    check("touch tap on open water orders the boat there", move.active === 1 && targetIsWater, JSON.stringify(move));
  }
  // board a barge by tapping it: spawn one AT the visible water point, then
  // sweep the neighborhood for its mesh
  const barge2 = await page.evaluate(([wx, wz]) => {
    const b = window.__spawn(0, "transport_barge", wx, wz);
    window.__step(2);
    window.__forceFrame?.();
    return b;
  }, [waterPx?.wx ?? 100, waterPx?.wz ?? 100]);
  const bargePx = await page.evaluate(([barge, cx, cy]) => {
    for (let r = 0; r < 200; r += 6) {
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        const sx = cx + dx;
        const sy = cy + dy;
        if (sx < 0 || sy < 0 || sx > 1279 || sy > 719) continue;
        const p = window.__scene.pick(sx, sy);
        const eid = p?.pickedMesh ? window.__unitOfMesh?.(p.pickedMesh) : null;
        if (eid === barge) return { sx, sy };
      }
      if (r === 0) continue;
    }
    return null;
  }, [barge2, waterPx?.sx ?? 640, waterPx?.sy ?? 360]);
  if (bargePx) {
    await page.evaluate((inf) => { window.__selection.selected.clear(); window.__selection.selected.add(inf); }, setup.inf);
    await page.touchscreen.tap(bargePx.sx, bargePx.sy);
    await page.evaluate(() => window.__step(900));
    const aboard = await page.evaluate((barge) => (window.__sim.garrisons.get(barge) ?? []).length, barge2);
    check("touch tap on own transport boards the selected troops", aboard >= 1, `aboard=${aboard}`);
  } else {
    check("transport visible for touch boarding (pick sweep)", false, "barge never picked — may be offscreen");
  }
  await page.close();
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
