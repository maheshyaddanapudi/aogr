/**
 * HUD: bronze resource bar (food/wood/gold/favor/pop) + title + the
 * determinism plaque (live tick, state checksum, fps). Pure DOM/CSS.
 */
import "./hud.css";

export interface HudResources {
  food: number;
  wood: number;
  gold: number;
  favor: number;
  pop: number;
  popCap: number;
}

export interface Hud {
  update: (data: { tick: number; checksum: number; fps: number; seed: number; backend: string }) => void;
  updateResources: (r: HudResources) => void;
  setAge: (age: number, canAdvance: boolean) => void;
  onAgeUp: (cb: () => void) => void;
}

export function createHud(root: HTMLElement): Hud {
  root.innerHTML = `
    <div class="hud-topbar">
      <div class="hud-title">PANTHEONS<small>Age of the Reforged Gods</small></div>
      <div class="resource-bar">
        <span class="res res-food" title="Food"><i>❖</i><b data-r="food">0</b></span>
        <span class="res res-wood" title="Wood"><i>⬢</i><b data-r="wood">0</b></span>
        <span class="res res-gold" title="Gold"><i>◉</i><b data-r="gold">0</b></span>
        <span class="res res-favor" title="Favor"><i>☀</i><b data-r="favor">0</b></span>
        <span class="res res-pop" title="Population"><i>⚑</i><b data-r="pop">0/0</b></span>
      </div>
      <div class="age-wrap" style="display:flex;gap:10px;align-items:center">
        <span class="age-chip" data-f="age">Archaic Age</span>
        <button class="age-up-btn" data-f="ageup" disabled>Advance Age</button>
      </div>
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
  const res = (name: string) => root.querySelector<HTMLElement>(`[data-r="${name}"]`)!;
  const seedEl = field("seed");
  const tickEl = field("tick");
  const checksumEl = field("checksum");
  const fpsEl = field("fps");
  const els = { food: res("food"), wood: res("wood"), gold: res("gold"), favor: res("favor"), pop: res("pop") };

  const AGE_NAMES = ["Archaic Age", "Classical Age", "Heroic Age", "Mythic Age"];
  const ageEl = field("age");
  const ageBtn = field("ageup") as HTMLButtonElement;
  let ageUpCb: (() => void) | null = null;
  ageBtn.addEventListener("click", () => ageUpCb?.());

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
    setAge(age, canAdvance) {
      ageEl.textContent = AGE_NAMES[age] ?? "—";
      ageBtn.disabled = !canAdvance;
    },
    onAgeUp(cb) {
      ageUpCb = cb;
    },
    updateResources(r) {
      els.food.textContent = String(r.food);
      els.wood.textContent = String(r.wood);
      els.gold.textContent = String(r.gold);
      els.favor.textContent = String(r.favor);
      els.pop.textContent = `${r.pop}/${r.popCap}`;
    },
  };
}
