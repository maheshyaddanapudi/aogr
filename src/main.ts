/**
 * Entry: the main menu (light DOM shell). The Babylon-heavy game module loads
 * on demand via dynamic import, keeping the initial bundle small (Phase 10
 * code-split requirement). ?skipmenu preserves the direct-boot behavior that
 * all headless gate captures rely on.
 */
import "./ui/hud.css";
import { listPantheonIds, getPantheon } from "./sim/pantheondata";
import { loadGame, loadSettings, saveSettings } from "./platform/storage";

const params = new URLSearchParams(location.search);

// Menu music: starts on the first interaction (autoplay rules), lazily pulling
// in Howler so the initial chunk stays small. The game's own audio system
// takes over at boot.
let menuMusic: { stop: () => void } | null = null;
let menuMusicWanted = true;
function armMenuMusic(): void {
  const start = () => {
    window.removeEventListener("pointerdown", start);
    const vol = loadSettings().musicVol;
    if (!menuMusicWanted || vol <= 0) return;
    void import("howler").then(({ Howl }) => {
      if (!menuMusicWanted) return;
      const h = new Howl({ src: [`${import.meta.env.BASE_URL}audio/music_main.mp3`], loop: true, volume: vol });
      h.play();
      menuMusic = h;
    });
  };
  window.addEventListener("pointerdown", start);
}

async function startGame(config: Parameters<typeof import("./game").boot>[0]): Promise<void> {
  document.getElementById("main-menu")?.remove();
  menuMusicWanted = false;
  menuMusic?.stop();
  const loading = document.createElement("div");
  loading.className = "loading-overlay";
  loading.id = "loading-overlay";
  loading.innerHTML = `
    <div class="loading-rune"></div>
    <h2>Forging the world…</h2>
    <p>First load downloads the gods, beasts, and terrain — give it a moment.</p>`;
  document.body.appendChild(loading);
  try {
    const { boot } = await import("./game");
    await boot(config);
    loading.remove();
  } catch (err) {
    loading.innerHTML = `
      <h2>The forge went cold</h2>
      <p>${err instanceof Error ? err.message : "The world failed to load."}</p>
      <button class="age-up-btn" id="boot-retry">Return to menu</button>`;
    loading.querySelector("#boot-retry")!.addEventListener("click", () => location.assign(location.pathname));
    throw err;
  }
}

function renderMenu(): void {
  const menu = document.createElement("div");
  menu.id = "main-menu";
  menu.className = "main-menu";
  const settings = loadSettings();
  menu.innerHTML = `
    <div class="menu-card">
      <h1 class="menu-title">PANTHEONS</h1>
      <p class="menu-sub">Age of the Reforged Gods</p>
      <div class="menu-section">
        <h2>Choose your pantheon</h2>
        <div class="pantheon-row"></div>
      </div>
      <div class="menu-section menu-opts">
        <label>Opponent
          <select id="m-ai">
            <option value="easy">Easy</option>
            <option value="medium" selected>Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label>Map seed <input id="m-seed" type="number" value="${Math.trunc(Math.random() * 1_000_000)}" /></label>
        <label>Music <input id="m-music" type="range" min="0" max="100" value="${Math.round(settings.musicVol * 100)}" /></label>
        <label>Sound <input id="m-sfx" type="range" min="0" max="100" value="${Math.round(settings.sfxVol * 100)}" /></label>
      </div>
      <div class="menu-actions">
        <button id="m-start" class="age-up-btn">Begin the Age</button>
        <button id="m-continue" class="age-up-btn" disabled>Continue saved match</button>
      </div>
      <p class="menu-credits">CC0 art by Kay Lousberg, Kenney, ambientCG · Music: Kevin MacLeod (CC-BY) · Built with Babylon.js + bitECS</p>
    </div>`;
  document.body.appendChild(menu);

  let chosen = "storm_concord";
  const row = menu.querySelector(".pantheon-row")!;
  for (const id of listPantheonIds()) {
    const p = getPantheon(id);
    const card = document.createElement("button");
    card.className = "god-card pantheon-card" + (id === chosen ? " chosen" : "");
    card.style.setProperty("--pantheon", p.colorIdentity);
    card.innerHTML = `<h2>${p.name.replace("The ", "")}</h2><h3>${p.theme}</h3><p class="god-blurb">${(p.favorMechanic as { description?: string }).description ?? ""}</p>`;
    card.addEventListener("click", () => {
      chosen = id;
      row.querySelectorAll(".pantheon-card").forEach((c) => c.classList.remove("chosen"));
      card.classList.add("chosen");
    });
    row.appendChild(card);
  }

  const persist = () => {
    saveSettings({
      musicVol: Number((menu.querySelector("#m-music") as HTMLInputElement).value) / 100,
      sfxVol: Number((menu.querySelector("#m-sfx") as HTMLInputElement).value) / 100,
    });
  };
  menu.querySelector("#m-music")!.addEventListener("change", persist);
  menu.querySelector("#m-sfx")!.addEventListener("change", persist);

  menu.querySelector("#m-start")!.addEventListener("click", () => {
    persist();
    void startGame({
      seed: Number((menu.querySelector("#m-seed") as HTMLInputElement).value) >>> 0,
      pantheon: chosen,
      majorGod: getPantheon(chosen).majors[0]!.id,
      aiDifficulty: (menu.querySelector("#m-ai") as HTMLSelectElement).value as "easy" | "medium" | "hard",
    });
  });

  void loadGame().then((snapshot) => {
    if (!snapshot) return;
    const btn = menu.querySelector("#m-continue") as HTMLButtonElement;
    btn.disabled = false;
    btn.addEventListener("click", () => {
      persist();
      void startGame({ loadSnapshot: snapshot } as never);
    });
  });
}

// Headless gates + power users boot straight into the game.
if (params.has("skipmenu") || params.has("seed")) {
  void startGame(undefined);
} else {
  renderMenu();
  armMenuMusic();
}
