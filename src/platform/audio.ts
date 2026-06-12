/**
 * Audio (Howler): music loop with combat ducking, distinct SFX per god power
 * (pattern sample × per-power deterministic pitch), combat hits, deaths, and
 * per-class unit acknowledgments. Starts on first user gesture (autoplay rules).
 */
import { Howl, Howler } from "howler";
import type { SimEvents } from "../sim/combat";
import { loadSettings } from "./storage";

const BASE = `${import.meta.env.BASE_URL}audio/`;

/** pattern family per power id — mirrors render/powerFx.ts */
const POWER_PATTERN: Record<string, string> = {
  solar_lance: "pillar", risen_champion: "pillar", call_of_the_last_war: "pillar", tricksters_gift: "pillar",
  vajra_bolt: "bolt", sovereign_bolt: "bolt",
  pyre_storm: "rain", cleansing_rain: "rain", tempest: "rain",
  searing_mirage: "swirl", mistveil: "swirl", maelstrom: "swirl", crosswinds: "swirl", mirrored_skies: "swirl",
  golden_flood: "ring", aegis_of_dawn: "ring", lure_of_tides: "ring", kelpward: "ring", ironhide: "ring", clarity: "ring",
  floodsurge: "burst", flaming_weapons: "burst", forge_quake: "burst", molten_rampart: "burst",
};

function hashRate(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 0.8 + (h % 50) / 100; // 0.8 – 1.3
}

export interface AudioSystem {
  /** call once per sim tick with that tick's events */
  collect: (events: SimEvents) => void;
  ack: (unitClass: string) => void;
  uiClick: () => void;
  /** war horn when the player's own units/buildings come under attack */
  alarm: () => void;
  /** soft chime when a unit finishes training */
  trained: (unitClass: string) => void;
  buildDone: () => void;
  readonly debug: { powerPlays: number; hitPlays: number; musicStarted: boolean; ducked: boolean; alarmPlays: number; trainedPlays: number; buildDonePlays: number };
}

export function createAudioSystem(): AudioSystem {
  const settings = loadSettings();
  const sfx = (file: string, volume = 0.6) => new Howl({ src: [`${BASE}${file}`], volume: volume * settings.sfxVol });
  const powers: Record<string, Howl> = {
    pillar: sfx("power_pillar.ogg", 0.7),
    bolt: sfx("power_bolt.ogg", 0.7),
    rain: sfx("power_rain.ogg", 0.7),
    swirl: sfx("power_swirl.ogg", 0.7),
    ring: sfx("power_ring.ogg", 0.7),
    burst: sfx("power_burst.ogg", 0.7),
  };
  const hitMelee = sfx("hit_melee.ogg", 0.35);
  const arrow = sfx("arrow.ogg", 0.3);
  const death = sfx("death.ogg", 0.5);
  const acks: Record<string, Howl> = {
    villager: sfx("ack_villager.ogg", 0.5),
    scout: sfx("ack_scout.ogg", 0.5),
    hero: sfx("ack_hero.ogg", 0.5),
    military: sfx("ack_military.ogg", 0.5),
  };
  const click = sfx("ui_click.ogg", 0.4);
  const buildDoneSfx = sfx("build_done.ogg", 0.55);
  // war horn: the pillar swell pitched far down reads as a horn blast until a
  // dedicated sample is sourced (swap the file, keep the hook)
  const horn = sfx("power_pillar.ogg", 0.85);
  const music = new Howl({ src: [`${BASE}music_main.mp3`], loop: true, volume: settings.musicVol });

  const debug = { powerPlays: 0, hitPlays: 0, musicStarted: false, ducked: false, alarmPlays: 0, trainedPlays: 0, buildDonePlays: 0 };
  let lastAlarmMs = -100000;
  let lastCombatMs = -100000;

  const startMusic = () => {
    if (!debug.musicStarted) {
      debug.musicStarted = true;
      music.play();
      // iOS: if the tap didn't unlock the context yet, retry once it does
      music.once("playerror", () => music.once("unlock", () => music.play()));
    }
    window.removeEventListener("pointerdown", startMusic);
  };
  window.addEventListener("pointerdown", startMusic);

  // combat ducking: drop the music while fighting is fresh
  setInterval(() => {
    const fighting = performance.now() - lastCombatMs < 2500;
    if (fighting !== debug.ducked) {
      debug.ducked = fighting;
      const hi = settings.musicVol;
      const lo = settings.musicVol * 0.5;
      music.fade(fighting ? hi : lo, fighting ? lo : hi, 450);
    }
  }, 300);

  let hitBudget = 0;
  setInterval(() => (hitBudget = 0), 250); // max a few hit sounds per beat

  return {
    collect(events) {
      for (const cast of events.powerCasts) {
        const pattern = POWER_PATTERN[cast.power] ?? "burst";
        const h = powers[pattern]!;
        const id = h.play();
        h.rate(hashRate(cast.power), id);
        debug.powerPlays++;
      }
      if (events.fired.length > 0) {
        lastCombatMs = performance.now();
        if (hitBudget < 3) {
          for (const f of events.fired.slice(0, 2)) {
            (f.ranged ? arrow : hitMelee).play();
            hitBudget++;
            debug.hitPlays++;
          }
        }
      }
      for (const _d of events.deaths.slice(0, 1)) death.play();
    },
    ack(unitClass) {
      (acks[unitClass] ?? acks.military)!.play();
    },
    alarm() {
      // AoM-style "town under attack" horn, at most one blast per 15s
      if (performance.now() - lastAlarmMs < 15000) return;
      lastAlarmMs = performance.now();
      const id = horn.play();
      horn.rate(0.5, id);
      debug.alarmPlays++;
    },
    trained(unitClass) {
      const h = acks[unitClass] ?? acks.military!;
      const id = h.play();
      h.volume(0.3 * settings.sfxVol, id);
      h.rate(1.15, id);
      debug.trainedPlays++;
    },
    buildDone() {
      buildDoneSfx.play();
      debug.buildDonePlays++;
    },
    uiClick() {
      click.play();
    },
    debug,
  };
}

export { Howler };
