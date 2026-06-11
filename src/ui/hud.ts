/**
 * Phase 0 HUD: title bar + the determinism plaque (live tick, state
 * checksum, fps). Pure DOM/CSS over the canvas per KICKOFF §4.
 */
import "./hud.css";

export interface Hud {
  update: (data: { tick: number; checksum: number; fps: number; seed: number; backend: string }) => void;
}

export function createHud(root: HTMLElement): Hud {
  root.innerHTML = `
    <div class="hud-topbar">
      <div class="hud-title">PANTHEONS<small>Age of the Reforged Gods</small></div>
      <div class="hud-phase">Phase 1 — Terrain &amp; Camera</div>
    </div>
    <div class="plaque">
      <h2>Determinism Seal</h2>
      <dl>
        <dt>Seed</dt><dd data-f="seed">—</dd>
        <dt>Tick</dt><dd data-f="tick">0</dd>
        <dt>State checksum</dt><dd class="checksum" data-f="checksum">—</dd>
        <dt>Render</dt><dd data-f="fps">—</dd>
      </dl>
    </div>
  `;
  const field = (name: string) => root.querySelector<HTMLElement>(`[data-f="${name}"]`)!;
  const seedEl = field("seed");
  const tickEl = field("tick");
  const checksumEl = field("checksum");
  const fpsEl = field("fps");

  let lastChecksum = -1;
  return {
    update({ tick, checksum, fps, seed, backend }) {
      seedEl.textContent = String(seed >>> 0);
      tickEl.textContent = String(tick);
      fpsEl.textContent = `${fps.toFixed(0)} fps · ${backend}`;
      if (checksum !== lastChecksum) {
        lastChecksum = checksum;
        checksumEl.textContent = `0x${checksum.toString(16).padStart(8, "0").toUpperCase()}`;
        checksumEl.classList.add("pulse");
        setTimeout(() => checksumEl.classList.remove("pulse"), 240);
      }
    },
  };
}
