/**
 * God-power VFX: every power gets a distinct look from a pattern × palette
 * config. Patterns combine a transient MESH centerpiece (pillar/bolt/ring —
 * reads clearly even in stills) with a one-shot particle flourish.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import type { SimEvents } from "../sim/combat";
import { FP_ONE } from "../sim";

type Pattern = "pillar" | "bolt" | "rain" | "burst" | "swirl" | "ring";

interface FxConfig {
  pattern: Pattern;
  c1: Color3;
  c2: Color3;
  radius: number;
  durationMs: number;
}

const C = (r: number, g: number, b: number) => new Color3(r, g, b);

/** Distinct look per power: pattern × palette (KICKOFF Phase 6 visual gate). */
const FX: Record<string, FxConfig> = {
  // Auryan Dawn — solar golds
  solar_lance: { pattern: "pillar", c1: C(1.8, 1.4, 0.5), c2: C(1.6, 0.9, 0.2), radius: 2, durationMs: 1200 },
  golden_flood: { pattern: "ring", c1: C(1.6, 1.3, 0.4), c2: C(1.2, 1.0, 0.3), radius: 8, durationMs: 2000 },
  pyre_storm: { pattern: "rain", c1: C(1.7, 0.8, 0.2), c2: C(1.4, 0.3, 0.1), radius: 6, durationMs: 8000 },
  searing_mirage: { pattern: "swirl", c1: C(1.5, 1.2, 0.6), c2: C(1.2, 0.8, 0.3), radius: 8, durationMs: 3000 },
  risen_champion: { pattern: "pillar", c1: C(1.8, 1.6, 0.9), c2: C(1.5, 1.1, 0.4), radius: 2, durationMs: 2000 },
  aegis_of_dawn: { pattern: "ring", c1: C(1.7, 1.5, 0.7), c2: C(1.3, 1.0, 0.4), radius: 10, durationMs: 3000 },
  // Verdant Deep — teals/blues
  lure_of_tides: { pattern: "ring", c1: C(0.3, 1.2, 1.0), c2: C(0.2, 0.8, 0.9), radius: 4, durationMs: 2500 },
  cleansing_rain: { pattern: "rain", c1: C(0.5, 1.3, 1.1), c2: C(0.4, 1.0, 0.7), radius: 8, durationMs: 6000 },
  floodsurge: { pattern: "burst", c1: C(0.3, 0.9, 1.4), c2: C(0.2, 0.6, 1.1), radius: 6, durationMs: 1800 },
  mistveil: { pattern: "swirl", c1: C(0.7, 0.9, 1.0), c2: C(0.5, 0.7, 0.8), radius: 10, durationMs: 4000 },
  maelstrom: { pattern: "swirl", c1: C(0.2, 0.7, 1.3), c2: C(0.1, 0.4, 0.9), radius: 7, durationMs: 6000 },
  kelpward: { pattern: "ring", c1: C(0.3, 1.1, 0.5), c2: C(0.2, 0.8, 0.3), radius: 8, durationMs: 3000 },
  // Ashen Forge — fire/iron
  ironhide: { pattern: "ring", c1: C(1.2, 0.9, 0.6), c2: C(0.8, 0.6, 0.4), radius: 8, durationMs: 2200 },
  flaming_weapons: { pattern: "burst", c1: C(1.7, 0.7, 0.2), c2: C(1.4, 0.4, 0.1), radius: 5, durationMs: 1500 },
  vajra_bolt: { pattern: "bolt", c1: C(1.6, 1.6, 2.0), c2: C(1.0, 1.2, 1.8), radius: 2, durationMs: 900 },
  forge_quake: { pattern: "burst", c1: C(1.3, 0.6, 0.2), c2: C(0.8, 0.4, 0.2), radius: 8, durationMs: 2500 },
  call_of_the_last_war: { pattern: "pillar", c1: C(1.6, 0.5, 0.2), c2: C(1.2, 0.3, 0.1), radius: 3, durationMs: 2500 },
  molten_rampart: { pattern: "burst", c1: C(1.8, 0.6, 0.1), c2: C(1.2, 0.2, 0.05), radius: 7, durationMs: 2500 },
  // Storm Concord — indigo/white
  clarity: { pattern: "ring", c1: C(0.8, 1.0, 1.8), c2: C(0.6, 0.8, 1.4), radius: 9, durationMs: 2000 },
  crosswinds: { pattern: "swirl", c1: C(0.8, 1.1, 1.5), c2: C(0.6, 0.9, 1.2), radius: 10, durationMs: 3000 },
  tempest: { pattern: "rain", c1: C(0.6, 0.8, 1.6), c2: C(0.4, 0.6, 1.2), radius: 8, durationMs: 8000 },
  mirrored_skies: { pattern: "swirl", c1: C(1.0, 1.0, 1.6), c2: C(0.7, 0.7, 1.2), radius: 6, durationMs: 3000 },
  tricksters_gift: { pattern: "pillar", c1: C(1.2, 0.6, 1.6), c2: C(0.9, 0.4, 1.2), radius: 2, durationMs: 1500 },
  sovereign_bolt: { pattern: "bolt", c1: C(1.8, 1.8, 2.2), c2: C(1.2, 1.4, 2.0), radius: 4, durationMs: 1100 },
};

interface LiveFx {
  meshes: Mesh[];
  systems: ParticleSystem[];
  ageMs: number;
  durationMs: number;
}

export interface PowerFx {
  collect: (events: SimEvents, groundHeightAt: (x: number, z: number) => number) => void;
  update: (dtMs: number) => void;
}

export function createPowerFx(scene: Scene): PowerFx {
  // shared soft-dot particle texture
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      const a = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (size / 2));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * a * 255);
    }
  }
  const dotTex = new RawTexture(data, size, size, Engine.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);

  const live: LiveFx[] = [];

  const emissiveMat = (c: Color3): StandardMaterial => {
    const m = new StandardMaterial("fxMat", scene);
    m.emissiveColor = c;
    m.disableLighting = true;
    m.alpha = 0.75;
    m.alphaMode = Engine.ALPHA_ADD; // glow, don't paint
    m.backFaceCulling = false;
    return m;
  };

  const makeParticles = (cfg: FxConfig, pos: Vector3, count: number, dir1: Vector3, dir2: Vector3, speed: [number, number]): ParticleSystem => {
    const ps = new ParticleSystem("pfx", 600, scene);
    ps.particleTexture = dotTex;
    ps.emitter = pos.clone();
    ps.minEmitBox = new Vector3(-cfg.radius * 0.7, 0, -cfg.radius * 0.7);
    ps.maxEmitBox = new Vector3(cfg.radius * 0.7, 0.5, cfg.radius * 0.7);
    ps.color1 = new Color4(cfg.c1.r, cfg.c1.g, cfg.c1.b, 1);
    ps.color2 = new Color4(cfg.c2.r, cfg.c2.g, cfg.c2.b, 1);
    ps.colorDead = new Color4(cfg.c2.r * 0.4, cfg.c2.g * 0.4, cfg.c2.b * 0.4, 0);
    ps.minSize = 0.15;
    ps.maxSize = 0.45;
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1.4;
    ps.emitRate = count;
    ps.direction1 = dir1;
    ps.direction2 = dir2;
    ps.minEmitPower = speed[0];
    ps.maxEmitPower = speed[1];
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
    return ps;
  };

  const spawn = (powerId: string, x: number, z: number, groundY: number) => {
    const cfg = FX[powerId] ?? { pattern: "burst" as Pattern, c1: C(1.5, 1.5, 1.5), c2: C(1, 1, 1), radius: 4, durationMs: 1500 };
    const pos = new Vector3(x, groundY, z);
    const meshes: Mesh[] = [];
    const systems: ParticleSystem[] = [];

    if (cfg.pattern === "pillar") {
      const pillar = MeshBuilder.CreateCylinder("fxPillar", { height: 14, diameterTop: cfg.radius * 0.5, diameterBottom: cfg.radius * 1.1, tessellation: 12 }, scene);
      pillar.position = pos.add(new Vector3(0, 7, 0));
      pillar.material = emissiveMat(cfg.c1);
      meshes.push(pillar);
      systems.push(makeParticles(cfg, pos, 220, new Vector3(-0.4, 2.5, -0.4), new Vector3(0.4, 4, 0.4), [3, 7]));
    } else if (cfg.pattern === "bolt") {
      // jagged lightning: stacked thin boxes with alternating offsets
      let p = pos.add(new Vector3(0, 13, 0));
      for (let i = 0; i < 6; i++) {
        const seg = MeshBuilder.CreateBox("fxBolt", { width: 0.25, height: 2.6, depth: 0.25 }, scene);
        const off = (i % 2 === 0 ? 1 : -1) * 0.5;
        seg.position = p.add(new Vector3(off, -1.1, off * 0.6));
        seg.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.35;
        seg.material = emissiveMat(cfg.c1);
        meshes.push(seg);
        p = seg.position.add(new Vector3(0, -1.2, 0));
      }
      systems.push(makeParticles(cfg, pos, 300, new Vector3(-1.5, 1, -1.5), new Vector3(1.5, 3, 1.5), [4, 9]));
    } else if (cfg.pattern === "rain") {
      const ps = makeParticles(cfg, pos.add(new Vector3(0, 11, 0)), 350, new Vector3(-0.3, -6, -0.3), new Vector3(0.3, -9, 0.3), [5, 9]);
      systems.push(ps);
      const disc = MeshBuilder.CreateDisc("fxArea", { radius: cfg.radius, tessellation: 36 }, scene);
      disc.rotation.x = Math.PI / 2;
      disc.position = pos.add(new Vector3(0, 0.08, 0));
      const dm = emissiveMat(cfg.c2);
      dm.alpha = 0.3;
      disc.material = dm;
      meshes.push(disc);
    } else if (cfg.pattern === "burst") {
      const ring = MeshBuilder.CreateTorus("fxBurst", { diameter: cfg.radius, thickness: 0.35, tessellation: 36 }, scene);
      ring.position = pos.add(new Vector3(0, 0.4, 0));
      ring.material = emissiveMat(cfg.c1);
      meshes.push(ring);
      systems.push(makeParticles(cfg, pos, 400, new Vector3(-2, 1.5, -2), new Vector3(2, 4, 2), [5, 10]));
    } else if (cfg.pattern === "swirl") {
      for (let i = 0; i < 3; i++) {
        const arc = MeshBuilder.CreateTorus("fxSwirl", { diameter: cfg.radius * (0.5 + i * 0.4), thickness: 0.18, tessellation: 28 }, scene);
        arc.position = pos.add(new Vector3(0, 0.6 + i * 0.9, 0));
        arc.material = emissiveMat(i % 2 ? cfg.c2 : cfg.c1);
        meshes.push(arc);
      }
      systems.push(makeParticles(cfg, pos, 260, new Vector3(-2, 0.5, 2), new Vector3(2, 1.5, -2), [2, 5]));
    } else {
      // ring
      const ring = MeshBuilder.CreateTorus("fxRing", { diameter: cfg.radius * 2, thickness: 0.25, tessellation: 48 }, scene);
      ring.position = pos.add(new Vector3(0, 0.25, 0));
      ring.material = emissiveMat(cfg.c1);
      meshes.push(ring);
      systems.push(makeParticles(cfg, pos, 180, new Vector3(-0.3, 1, -0.3), new Vector3(0.3, 2.5, 0.3), [1, 3]));
    }
    live.push({ meshes, systems, ageMs: 0, durationMs: cfg.durationMs });
  };

  return {
    collect(events, groundHeightAt) {
      for (const cast of events.powerCasts) {
        const x = cast.x / FP_ONE;
        const z = cast.y / FP_ONE;
        spawn(cast.power, x, z, groundHeightAt(x, z));
      }
    },
    update(dtMs) {
      for (let i = live.length - 1; i >= 0; i--) {
        const fx = live[i]!;
        fx.ageMs += dtMs;
        const k = fx.ageMs / fx.durationMs;
        for (const m of fx.meshes) {
          if (m.rotation) m.rotation.y += dtMs * 0.003;
          if (m.material && "alpha" in m.material) (m.material as StandardMaterial).alpha = Math.max(0, 0.85 * (1 - k));
        }
        if (k >= 0.7) for (const s of fx.systems) s.emitRate = 0;
        if (k >= 1) {
          for (const m of fx.meshes) {
            m.material?.dispose();
            m.dispose();
          }
          for (const s of fx.systems) s.dispose();
          live.splice(i, 1);
        }
      }
    },
  };
}
