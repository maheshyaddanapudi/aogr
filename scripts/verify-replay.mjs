/**
 * Replay E2E (round-7 F14): record a real match headlessly, then feed the
 * replay back through the PRODUCTION path (menu → Watch replay → file input)
 * and prove the final checksum matches the recording lockstep-exactly.
 *   node scripts/verify-replay.mjs [seed] [gameMinutes]
 */
import { chromium } from "../node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const seed = Number(process.argv[2] ?? 424242);
const minutes = Number(process.argv[3] ?? 4);
const ticks = minutes * 900;

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

// ── leg 1: play + record ──
const rec = await ctx.newPage();
rec.on("pageerror", (e) => console.log("REC PAGEERROR:", e.message.slice(0, 120)));
await rec.goto(`http://localhost:4173/aogr/?paused&seed=${seed}&ai=medium`, { waitUntil: "domcontentloaded" });
await rec.waitForFunction(() => window.__sim !== undefined && window.__replay !== undefined, null, { timeout: 240000 });
await rec.evaluate((n) => window.__step(n), ticks);
const recorded = await rec.evaluate(() => ({
  replay: window.__replay(),
  checksum: window.__checksum(),
  tick: window.__sim.tick,
  cmdBatches: window.__replay().commands.length,
}));
console.log(`recorded: seed=${recorded.replay.seed} tick=${recorded.tick} cmdBatches=${recorded.cmdBatches} checksum=${recorded.checksum}`);
if (recorded.cmdBatches === 0) {
  console.log("FAIL: no commands recorded — the AI should have acted");
  process.exit(1);
}
await rec.close();

// ── leg 2: watch the replay through the real menu path ──
const replayFile = join(tmpdir(), `aogr-replay-${seed}.json`);
writeFileSync(replayFile, JSON.stringify(recorded.replay));
const watch = await ctx.newPage();
watch.on("pageerror", (e) => console.log("WATCH PAGEERROR:", e.message.slice(0, 120)));
await watch.goto("http://localhost:4173/aogr/?paused", { waitUntil: "domcontentloaded" }); // menu + paused boot
await watch.waitForSelector("#m-replay", { timeout: 60000 });
await watch.setInputFiles("#m-replay-file", replayFile);
await watch.waitForFunction(() => window.__sim !== undefined, null, { timeout: 240000 });
await watch.evaluate((n) => window.__step(n), recorded.tick);
const replayed = await watch.evaluate(() => ({ checksum: window.__checksum(), tick: window.__sim.tick, winner: window.__sim.winner }));
console.log(`replayed: tick=${replayed.tick} checksum=${replayed.checksum}`);

const ok = replayed.checksum === recorded.checksum && replayed.tick === recorded.tick;
console.log(ok ? `✔ REPLAY LOCKSTEP VERIFIED (${minutes} game-min, ${recorded.cmdBatches} command batches)` : "✘ REPLAY DIVERGED");
await browser.close();
process.exit(ok ? 0 : 1);
