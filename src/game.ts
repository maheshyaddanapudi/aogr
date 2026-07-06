/**
 * Boot: deterministic skirmish sim (15 Hz) + Babylon world scene + bronze HUD.
 * Phase 3 demo: a real economy — villagers gather food/wood/gold, a house goes
 * up, a villager trains at the TC, and (once a temple stands) villagers pray.
 */
import {
  CommandQueue,
  createSim,
  simChecksum,
  stepSim,
  nearestPassableTile,
  FP_ONE,
} from "./sim";
import { findResourceNodes, getPlayer } from "./sim/economy";
import { deserializeSim, serializeSim } from "./sim/sim";
import { getMinor, getPantheon } from "./sim/pantheondata";
import { getPower, nextCastCostMilli } from "./sim/powers";
import { saveGame } from "./platform/storage";
import { spawnUnitEntity } from "./sim";
import { getBuildingStatsByIndex } from "./sim/buildingdata";
import { hasComponent, query } from "bitecs";
import { createEngine, createWorldScene } from "./render/scene";
import { createUnitRenderer, type UnitAnimState } from "./render/units";
import { createWorldObjectsRenderer } from "./render/buildings";
import { createCombatFx } from "./render/combatFx";
import { createPowerFx } from "./render/powerFx";
import { setupSelection } from "./render/selection";
import { createPathService } from "./platform/pathService";
import { createAiService } from "./platform/aiService";
import { createAudioSystem } from "./platform/audio";
import { startLoop } from "./platform/loop";
import { createHud } from "./ui/hud";
import { createAgePanel } from "./ui/agePanel";
import { createMinimap } from "./ui/minimap";
import { createCommandCard } from "./ui/commandCard";
import { createFogRenderer } from "./render/fog";
import { isPassable as tilePassable } from "./sim/path/grid";
import { getBuildingStats } from "./sim/buildingdata";
import { VIS_VISIBLE } from "./sim/visibility";
import { getTechStats } from "./sim/techdata";
import { canAfford } from "./sim/economy";

const DEFAULT_SEED = 20260611;

export interface GameConfig {
  seed: number;
  pantheon: string;
  majorGod: string;
  aiDifficulty: "easiest" | "easy" | "medium" | "hard" | "titan" | "off";
  loadSnapshot?: string;
}

export async function boot(config?: Partial<GameConfig>): Promise<void> {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const hudRoot = document.getElementById("hud-root")!;

  const params = new URLSearchParams(location.search);
  const seed = (config?.seed ?? Number(params.get("seed") ?? DEFAULT_SEED)) >>> 0;
  // Demo script is OPT-IN (?demo): it commandeers player 0's villagers and
  // spawns battle lines — must never run in a real menu-started match.
  const demo = params.has("demo") && !config?.loadSnapshot;

  const sim = config?.loadSnapshot
    ? deserializeSim(config.loadSnapshot)
    : createSim(seed, undefined, { players: 2, skirmish: true });
  if (!config?.loadSnapshot && config?.pantheon) {
    getPlayer(sim, 0).pantheon = config.pantheon;
    getPlayer(sim, 0).majorGod = config.majorGod ?? getPantheon(config.pantheon).majors[0]!.id;
  }
  const queue = new CommandQueue();

  // Phase 3 demo script: task the starting villagers, expand, train.
  if (demo) {
    const vills = Array.from(query(sim.world, [sim.stores.UnitRef]))
      .filter((e) => sim.stores.Owner.playerId[e] === 0 && sim.unitStats(e).id === "villager")
      .sort((a, b) => a - b);
    const tc = getPlayer(sim, 0).townCenterEid;
    const near = (eids: number[], kind: "food" | "wood" | "gold") => {
      const nodes = findResourceNodes(sim, kind);
      const { Position } = sim.stores;
      let best = nodes[0]!;
      let bestD = Number.MAX_SAFE_INTEGER;
      for (const n of nodes) {
        const dx = Position.x[n]! - Position.x[tc]!;
        const dy = Position.y[n]! - Position.y[tc]!;
        if (dx * dx + dy * dy < bestD) {
          bestD = dx * dx + dy * dy;
          best = n;
        }
      }
      return { type: "gather" as const, playerId: 0, eids, nodeEid: best };
    };
    queue.enqueue(1, near([vills[0]!, vills[1]!], "food"));
    queue.enqueue(1, near([vills[2]!], "wood"));
    queue.enqueue(2, near([vills[3]!], "gold"));
    queue.enqueue(30, { type: "train", playerId: 0, buildingEid: tc, unit: "villager" });
    queue.enqueue(300, { type: "build", playerId: 0, eids: [vills[3]!], building: "house", x: -1, y: -1 });
    queue.enqueue(900, { type: "build", playerId: 0, eids: [vills[2]!], building: "temple", x: -1, y: -1 });
    queue.enqueue(2200, { type: "pray", playerId: 0, eids: [vills[2]!, vills[3]!] });
    // Phase 4 combat demo: two battle lines clash on the central plain
    const mid = Math.trunc(sim.terrain.size / 2);
    for (let i = 0; i < 6; i++) {
      queue.enqueue(60, { type: "spawn_unit", playerId: 0, unit: "infantry_base", x: (mid - 6 + i * 2) * FP_ONE, y: (mid - 4) * FP_ONE });
      queue.enqueue(60, { type: "spawn_unit", playerId: 1, unit: i % 2 ? "archer_base" : "infantry_base", x: (mid - 6 + i * 2) * FP_ONE, y: (mid + 4) * FP_ONE });
    }
    // military spawns aggressive: the lines auto-acquire each other (LOS 12 > 8-tile gap)
  }

  const engine = await createEngine(canvas);
  const world = createWorldScene(engine, canvas, sim.terrain);
  const unitRenderer = await createUnitRenderer(world.scene, world.shadows);
  const objects = await createWorldObjectsRenderer(world.scene, world.shadows);
  // cosmetic scatter (rocks/stumps) on open land, clear of resources and bases
  {
    const { Position, ResourceNode, Building } = sim.stores;
    const blocked: Array<{ x: number; z: number; r: number }> = [];
    for (const eid of query(sim.world, [ResourceNode])) blocked.push({ x: Position.x[eid]! / FP_ONE, z: Position.y[eid]! / FP_ONE, r: 3 });
    for (const eid of query(sim.world, [Building])) blocked.push({ x: Position.x[eid]! / FP_ONE, z: Position.y[eid]! / FP_ONE, r: 14 });
    objects.scatter(
      world.groundHeightAt,
      (x, z) => tilePassable(sim.navGrid, Math.trunc(x), Math.trunc(z)) && !blocked.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r),
      sim.terrain.size,
      seed ^ 0x5ca77e2,
    );
  }
  // settlement sites: bronze rings on the ground where town centers may rise
  {
    const { MeshBuilder } = await import("@babylonjs/core/Meshes/meshBuilder");
    const { StandardMaterial } = await import("@babylonjs/core/Materials/standardMaterial");
    const { Color3 } = await import("@babylonjs/core/Maths/math.color");
    const rm = new StandardMaterial("settleMat", world.scene);
    rm.emissiveColor = new Color3(0.75, 0.6, 0.25);
    rm.disableLighting = true;
    rm.alpha = 0.7;
    for (const st of sim.settlements) {
      const ring = MeshBuilder.CreateTorus(`settlement_${st.x}_${st.y}`, { diameter: 7, thickness: 0.18, tessellation: 40 }, world.scene);
      ring.material = rm;
      ring.isPickable = false;
      ring.position.set(st.x, world.groundHeightAt(st.x, st.y) + 0.15, st.y);
    }
  }
  const combatFx = await createCombatFx(world.scene);
  const powerFx = createPowerFx(world.scene);
  const fog = createFogRenderer(world.scene, sim.terrain.size, sim.terrain);
  const audio = createAudioSystem();
  const pathService = createPathService(sim);
  const aiChoice = config?.aiDifficulty ?? ((params.get("ai") ?? "medium") as "easiest" | "easy" | "medium" | "hard" | "titan" | "off");
  const aiService = aiChoice === "off" || params.get("ai") === "off" ? null : createAiService(1, aiChoice as "easiest" | "easy" | "medium" | "hard" | "titan", seed);
  const hud = createHud(hudRoot);
  const agePanel = createAgePanel((tech, minorGod) => {
    queue.enqueue(sim.tick + 1, { type: "research", playerId: 0, tech, minorGod });
  });
  const AGE_TIERS = ["classical", "heroic", "mythic"] as const;
  const AGE_TECHS = ["age_classical", "age_heroic", "age_mythic"] as const;
  const canAgeUp = (): boolean => {
    const p = getPlayer(sim, 0);
    if (p.age >= 3 || p.researchQueue.some((r) => r.techId.startsWith("age_"))) return false;
    const tech = getTechStats(AGE_TECHS[p.age]!);
    if (!canAfford(p, tech.cost)) return false;
    if (!tech.requiresBuilding) return true;
    const { Owner, Building } = sim.stores;
    for (const eid of query(sim.world, [Building])) {
      if (Owner.playerId[eid] === 0 && Building.active[eid] === 1 &&
          getBuildingStatsByIndex(Building.typeIndex[eid]!).id === tech.requiresBuilding) return true;
    }
    return false;
  };
  hud.onAgeUp(() => {
    const p = getPlayer(sim, 0);
    if (p.age < 3) agePanel.show(p.pantheon, p.majorGod, AGE_TIERS[p.age]!);
  });
  const backend = engine.constructor.name === "WebGPUEngine" ? "WebGPU" : "WebGL2";

  type UnitView = {
    eid: number;
    x: number;
    z: number;
    vx: number;
    vz: number;
    playerId: number;
    unitClass: string;
    unitId: string;
    pantheon: string;
    anim: UnitAnimState;
  };
  const unitView: UnitView[] = [];
  const buildingView: {
    eid: number;
    buildingId: string;
    playerId: number;
    x: number;
    z: number;
    size: number;
    progress: number;
    total: number;
    active: boolean;
    hpFrac: number;
  }[] = [];
  const nodeView: { eid: number; resType: number; x: number; z: number; depleted: boolean }[] = [];

  const refreshViews = () => {
    const { Position, Velocity, Owner, UnitRef, MoveState, GatherTask, Building, ResourceNode } = sim.stores;
    unitView.length = 0;
    for (const eid of query(sim.world, [Position, UnitRef])) {
      if (sim.garrisonOf.has(eid)) continue; // inside a building
      const phase = GatherTask.phase[eid] ?? 0;
      const CombatState = sim.stores.CombatState;
      const fighting =
        hasComponent(sim.world, eid, CombatState) &&
        CombatState.targetEid[eid]! >= 0 &&
        MoveState.active[eid] !== 1;
      const anim: UnitAnimState =
        fighting || phase === 2 || phase === 4 || phase === 5 || phase === 6 ? "work" : MoveState.active[eid] === 1 ? "walk" : "idle";
      const stats = sim.unitStats(eid);
      unitView.push({
        eid,
        x: Position.x[eid]! / FP_ONE,
        z: Position.y[eid]! / FP_ONE,
        vx: Velocity.x[eid]! / FP_ONE,
        vz: Velocity.y[eid]! / FP_ONE,
        playerId: Owner.playerId[eid]!,
        unitClass: stats.unitClass,
        unitId: stats.id,
        pantheon: sim.players[Owner.playerId[eid]!]?.pantheon ?? "storm_concord",
        anim,
      });
    }
    buildingView.length = 0;
    for (const eid of query(sim.world, [Building])) {
      const stats = getBuildingStatsByIndex(Building.typeIndex[eid]!);
      buildingView.push({
        eid,
        buildingId: stats.id,
        playerId: Owner.playerId[eid]!,
        x: Position.x[eid]! / FP_ONE,
        z: Position.y[eid]! / FP_ONE,
        size: stats.size,
        progress: Building.progress[eid]!,
        total: Building.total[eid]!,
        active: Building.active[eid] === 1,
        hpFrac: Math.max(0, Math.min(1, (sim.stores.Health.hp100[eid] ?? 0) / Math.max(1, stats.hp100))),
      });
    }
    nodeView.length = 0;
    for (const eid of query(sim.world, [ResourceNode])) {
      nodeView.push({
        eid,
        resType: ResourceNode.resType[eid]!,
        x: Position.x[eid]! / FP_ONE,
        z: Position.y[eid]! / FP_ONE,
        depleted: ResourceNode.amountMilli[eid]! <= 0,
      });
    }
  };

  let formationPref = 0;
  const selection = setupSelection({
    scene: world.scene,
    canvas,
    camera: world.rtsCamera.camera,
    queue,
    localPlayerId: 0,
    currentTick: () => sim.tick,
    unitPositions: () => unitView,
    isUnitMesh: (m) => unitRenderer.isUnitMesh(m),
    isNodeMesh: (m) => objects.isNodeMesh(m),
    isBuildingMesh: (m) => objects.isBuildingMesh(m),
    buildingOwner: (eid) => sim.stores.Owner.playerId[eid] ?? -1,
    buildingActive: (eid) => sim.stores.Building.active[eid] === 1,
    garrisonCapacity: (eid) => getBuildingStatsByIndex(sim.stores.Building.typeIndex[eid]!).garrisonCapacity,
    formation: () => formationPref,
    unitTypeOf: (eid) => (sim.stores.UnitRef.typeIndex[eid] !== undefined ? sim.unitStats(eid).id : null),
    farmFoodNode: (eid) => {
      const { Position, ResourceNode, Building } = sim.stores;
      const stats = getBuildingStatsByIndex(Building.typeIndex[eid]!);
      if (!stats.isFarm || Building.active[eid] !== 1) return null;
      const half = (stats.size * FP_ONE) / 2;
      for (const n of query(sim.world, [ResourceNode])) {
        if (ResourceNode.resType[n] !== 0 || ResourceNode.amountMilli[n]! <= 0) continue;
        if (Math.abs(Position.x[n]! - Position.x[eid]!) <= half && Math.abs(Position.y[n]! - Position.y[eid]!) <= half) return n;
      }
      return null;
    },
    canPlace: (buildingId, tx, ty) => {
      const size = getBuildingStats(buildingId).size;
      for (let y = ty - 1; y < ty + size + 1; y++) {
        for (let x = tx - 1; x < tx + size + 1; x++) {
          if (!tilePassable(sim.navGrid, x, y)) return false;
        }
      }
      return true;
    },
    onGhost: (size, x, z, ok) => objects.showGhost(size, x, z, ok, world.groundHeightAt(x, z)),
    onGhostEnd: () => objects.hideGhost(),
    groundHeightAt: world.groundHeightAt,
    onMoveOrder: (tx, ty) => {
      const snapped = nearestPassableTile(sim, tx, ty);
      pathService.prewarm(snapped.x, snapped.y);
    },
  });

  const minimap = createMinimap(hudRoot, sim, (mx, mz) => {
    world.rtsCamera.camera.target.x = mx;
    world.rtsCamera.camera.target.z = mz;
  });
  const commandCard = createCommandCard(hudRoot, {
    onBuild: (buildingId) => {
      audio.uiClick();
      selection.enterPlacement(buildingId, getBuildingStats(buildingId).size);
    },
    onTrain: (buildingEid, unitId) => {
      audio.uiClick();
      queue.enqueue(sim.tick + 1, { type: "train", playerId: 0, buildingEid, unit: unitId });
    },
    onResearch: (techId) => {
      audio.uiClick();
      queue.enqueue(sim.tick + 1, { type: "research", playerId: 0, tech: techId });
    },
    onCancelTrain: (buildingEid, index) => {
      audio.uiClick();
      queue.enqueue(sim.tick + 1, { type: "cancel_train", playerId: 0, buildingEid, index });
    },
    onStance: (stance) => {
      audio.uiClick();
      queue.enqueue(sim.tick + 1, { type: "stance", playerId: 0, eids: Array.from(selection.selected), stance });
    },
    onFormation: (f) => {
      audio.uiClick();
      formationPref = f;
    },
    onUngarrison: (buildingEid) => {
      audio.uiClick();
      queue.enqueue(sim.tick + 1, { type: "ungarrison", playerId: 0, buildingEid });
    },
    onDeselect: () => {
      audio.uiClick();
      selection.clear();
    },
  });

  // ── god-power bar: the player's unlocked powers, cast by click/tap ──
  const powerBar = document.createElement("div");
  powerBar.className = "power-bar";
  hudRoot.appendChild(powerBar);
  let pendingPower: string | null = null;
  const refreshPowerBar = () => {
    const p = getPlayer(sim, 0);
    powerBar.innerHTML = "";
    for (const minorId of p.minorGods) {
      let powerId: string;
      try {
        powerId = getMinor(p.pantheon, minorId).grants.power;
      } catch {
        continue;
      }
      const power = getPower(powerId);
      const cost = nextCastCostMilli(power, p.castCounts[powerId] ?? 0);
      const cdLeft = Math.max(0, (p.powerReadyTick[powerId] ?? 0) - sim.tick);
      const ready = p.favorMilli >= cost && cdLeft === 0;
      const btn = document.createElement("button");
      btn.className = "power-btn" + (pendingPower === powerId ? " armed" : "");
      btn.disabled = !ready && pendingPower !== powerId;
      btn.innerHTML = `<b>${power.name}</b><small>${cdLeft > 0 ? `${Math.ceil(cdLeft / 15)}s` : `${Math.ceil(cost / 1000)} favor`}</small>`;
      btn.title = `${power.name} — click, then click the map to target`;
      btn.addEventListener("click", () => {
        audio.uiClick();
        pendingPower = pendingPower === powerId ? null : powerId;
        refreshPowerBar();
      });
      powerBar.appendChild(btn);
    }
    powerBar.style.display = powerBar.childElementCount > 0 ? "" : "none";
  };
  // targeting: an armed power consumes the next map click/tap (capture phase
  // so selection/orders never see it)
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (!pendingPower || e.button !== 0) return;
      const pick = world.scene.pick(e.clientX, e.clientY, (m) => m.name === "terrain");
      if (pick?.pickedPoint) {
        queue.enqueue(sim.tick + 1, {
          type: "cast_power",
          playerId: 0,
          power: pendingPower,
          x: Math.round(pick.pickedPoint.x * FP_ONE),
          y: Math.round(pick.pickedPoint.z * FP_ONE),
        });
        pendingPower = null;
        refreshPowerBar();
      }
      e.stopPropagation();
      e.preventDefault();
    },
    { capture: true },
  );
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && pendingPower) {
      pendingPower = null;
      refreshPowerBar();
    }
  });
  // unit acknowledgment on selection
  let lastSelSize = 0;
  setInterval(() => {
    const size = selection.selected.size;
    if (size > 0 && size !== lastSelSize) {
      const first = selection.selected.values().next().value as number;
      try {
        audio.ack(["villager", "scout"].includes(sim.unitStats(first).unitClass) ? sim.unitStats(first).unitClass : sim.unitStats(first).unitClass === "hero" ? "hero" : "military");
      } catch { /* entity died */ }
    }
    lastSelSize = size;
  }, 200);

  // frame the player base
  const tcEid = getPlayer(sim, 0).townCenterEid;
  world.rtsCamera.camera.target.x = sim.stores.Position.x[tcEid]! / FP_ONE;
  world.rtsCamera.camera.target.z = sim.stores.Position.y[tcEid]! / FP_ONE + 6;
  world.rtsCamera.camera.radius = 42;

  let checksum = simChecksum(sim);

  let uiPulse = 0;
  const renderFrame = () => {
    refreshViews();
    unitRenderer.update(unitView, world.groundHeightAt, selection.selected, (u) =>
      u.playerId === 0 ? true : fog.isTileVisible(sim, 0, u.x, u.z),
    );
    objects.update(buildingView, nodeView, world.groundHeightAt);
    if (uiPulse++ % 8 === 0) {
      fog.refresh(sim, 0);
      minimap.refresh(sim, 0);
      const selUnits = unitView
        .filter((u) => selection.selected.has(u.eid))
        .map((u) => ({
          eid: u.eid,
          unitClass: u.unitClass,
          name: sim.unitStats(u.eid).name,
          hp: Math.ceil((sim.stores.Health.hp100[u.eid] ?? 0) / 100),
          maxHp: Math.ceil(sim.unitStats(u.eid).hp100 / 100),
        }));
      const selB = selection.selectedBuilding();
      commandCard.refresh(sim, 0, selUnits, selB !== null ? { eid: selB, buildingId: sim.buildingIdOf(selB) } : null, selB !== null ? sim.trainQueues.get(selB) ?? null : null, selB !== null ? (sim.garrisons.get(selB) ?? []).length : 0);
      refreshPowerBar();
      updateIdleBtn();
    }
    world.scene.render();
    const p = getPlayer(sim, 0);
    hud.update({ tick: sim.tick, checksum, fps: engine.getFps(), seed, backend });
    hud.setAge(p.age, canAgeUp());
    hud.setPantheon(p.pantheon);
    hud.updateResources({
      food: Math.trunc(p.foodMilli / 1000),
      wood: Math.trunc(p.woodMilli / 1000),
      gold: Math.trunc(p.goldMilli / 1000),
      favor: Math.trunc(p.favorMilli / 1000),
      pop: p.popUsed,
      popCap: p.popCap,
    });
  };

  // AoM-style notifications: war horn when our own things take fire, a soft
  // chime when a unit finishes training, a thunk when a building completes.
  let knownOwnUnits = new Set<number>();
  let knownActiveBuildings = new Set<number>();
  let notifyArmed = false; // skip the initial population
  const matchStats = { kills: 0, losses: 0, razed: 0, startedAt: Date.now() };
  const collectNotifications = () => {
    const { Owner, UnitRef, Building } = sim.stores;
    for (const f of sim.events.fired) {
      if (Owner.playerId[f.to] === 0) {
        audio.alarm();
        minimap.ping(f.toX / FP_ONE, f.toY / FP_ONE);
        break;
      }
    }
    for (const d of sim.events.deaths) {
      if (d.playerId === 0) matchStats.losses++;
      else matchStats.kills++;
    }
    const units = new Set<number>();
    for (const eid of query(sim.world, [UnitRef])) if (Owner.playerId[eid] === 0) units.add(eid);
    const actives = new Set<number>();
    for (const eid of query(sim.world, [Building])) {
      if (Owner.playerId[eid] === 0 && sim.stores.Building.active[eid] === 1) actives.add(eid);
    }
    if (notifyArmed) {
      for (const eid of units) if (!knownOwnUnits.has(eid)) audio.trained(sim.unitStats(eid).unitClass);
      for (const eid of actives) if (!knownActiveBuildings.has(eid)) audio.buildDone();
    }
    knownOwnUnits = units;
    knownActiveBuildings = actives;
    notifyArmed = true;
  };

  // ?paused: gate-capture mode — sim/render driven only via __step/__forceFrame
  const loopCtl = params.has("paused") ? null : startLoop({
    onTick: () => {
      aiService?.onTick(sim, queue);
      stepSim(sim, queue.drain(sim.tick));
      combatFx.collect(sim.events, world.groundHeightAt);
      powerFx.collect(sim.events, world.groundHeightAt);
      audio.collect(sim.events);
      collectNotifications();
      if (sim.tick % 15 === 0) checksum = simChecksum(sim);
    },
    onFrame: (alpha, dtMs) => {
      combatFx.update(dtMs);
      powerFx.update(dtMs);
      renderFrame();
    },
  });
  if (loopCtl) {
    const pauseBtn = document.createElement("button");
    pauseBtn.className = "age-up-btn save-btn";
    pauseBtn.textContent = "⏸";
    pauseBtn.title = "Pause / resume";
    pauseBtn.addEventListener("click", () => {
      loopCtl.setPaused(!loopCtl.isPaused());
      pauseBtn.textContent = loopCtl.isPaused() ? "▶" : "⏸";
    });
    const speedBtn = document.createElement("button");
    speedBtn.className = "age-up-btn save-btn";
    speedBtn.textContent = "1×";
    speedBtn.title = "Game speed";
    speedBtn.addEventListener("click", () => {
      const next = loopCtl.speed() >= 2 ? 1 : loopCtl.speed() * 2;
      loopCtl.setSpeed(next);
      speedBtn.textContent = `${next}×`;
    });
    document.querySelector(".age-wrap")?.append(pauseBtn, speedBtn);
  }

  window.addEventListener("resize", () => engine.resize());

  // Texture-decode race guard: effects can compile before their textures
  // finish decoding and never re-specialize (white-material syndrome on slow
  // stacks). Re-mark materials dirty a few times after boot — cheap, and a
  // no-op when everything was already specialized correctly.
  const remat = () => {
    for (const m of world.scene.materials) {
      try {
        m.markAsDirty(63 /* AllDirtyFlag */);
      } catch {
        /* some material types don't support it */
      }
    }
  };
  for (const t of [1500, 4000, 9000, 16000]) setTimeout(remat, t);
  (window as unknown as Record<string, unknown>).__remat = remat;

  // victory / defeat overlay
  let endShown = false;
  setInterval(() => {
    if (endShown || sim.winner < 0) return;
    endShown = true;
    const overlay = document.createElement("div");
    overlay.className = "age-overlay";
    overlay.innerHTML = `
      <div class="age-panel">
        <h1>${sim.winner === 0 ? "VICTORY" : "DEFEAT"}</h1>
        <p class="age-sub">${sim.winner === 0 ? "The reforged gods favor you" : "Your pantheon falls silent"}</p>
        <p class="end-stats">${Math.trunc(sim.tick / 900)} min · ${["Archaic", "Classical", "Heroic", "Mythic"][getPlayer(sim, 0).age]} Age · ${matchStats.kills} kills · ${matchStats.losses} losses</p>
        <div class="god-cards"><button class="god-card" id="end-menu"><h2>Return to Menu</h2></button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#end-menu")!.addEventListener("click", () => location.assign(location.pathname));
  }, 500);

  // save button
  const saveBtn = document.createElement("button");
  saveBtn.className = "age-up-btn save-btn";
  saveBtn.textContent = "Save";
  saveBtn.title = "Save the match (resume from the main menu)";
  saveBtn.addEventListener("click", () => {
    void saveGame(serializeSim(sim)).then(() => {
      saveBtn.textContent = "Saved ✓";
      setTimeout(() => (saveBtn.textContent = "Save"), 1500);
    });
  });
  document.querySelector(".age-wrap")?.appendChild(saveBtn);

  // idle villager finder (💤): click cycles through workless villagers
  const idleBtn = document.createElement("button");
  idleBtn.className = "age-up-btn save-btn idle-btn";
  idleBtn.title = "Select the next idle villager";
  idleBtn.textContent = "💤 0";
  let idleCursor = 0;
  const idleVillagers = (): number[] => {
    const { GatherTask, MoveState, Owner, UnitRef } = sim.stores;
    return Array.from(query(sim.world, [UnitRef, GatherTask]))
      .filter((e) => Owner.playerId[e] === 0 && sim.unitStats(e).unitClass === "villager" && GatherTask.phase[e] === 0 && MoveState.active[e] !== 1)
      .sort((a, b) => a - b);
  };
  const updateIdleBtn = () => {
    const n = idleVillagers().length;
    idleBtn.textContent = `💤 ${n}`;
    idleBtn.disabled = n === 0;
  };
  idleBtn.addEventListener("click", () => {
    const idle = idleVillagers();
    if (idle.length === 0) return;
    const eid = idle[idleCursor++ % idle.length]!;
    selection.clear();
    (selection.selected as Set<number>).add(eid);
    const { Position } = sim.stores;
    world.rtsCamera.camera.target.x = Position.x[eid]! / FP_ONE;
    world.rtsCamera.camera.target.z = Position.y[eid]! / FP_ONE;
    audio.uiClick();
  });
  document.querySelector(".age-wrap")?.appendChild(idleBtn);

  // exit to menu (saves first so nothing is lost)
  const menuBtn = document.createElement("button");
  menuBtn.className = "age-up-btn save-btn";
  menuBtn.textContent = "Menu";
  menuBtn.title = "Save and return to the main menu";
  menuBtn.addEventListener("click", () => {
    void saveGame(serializeSim(sim)).finally(() => location.assign(location.pathname));
  });
  document.querySelector(".age-wrap")?.appendChild(menuBtn);
  // Debug handles for headless gate probes (harmless in production).
  (window as unknown as Record<string, unknown>).__scene = world.scene;
  (window as unknown as Record<string, unknown>).__sim = sim;
  (window as unknown as Record<string, unknown>).__selection = selection;
  (window as unknown as Record<string, unknown>).__audio = audio;
  (window as unknown as Record<string, unknown>).__forceFrame = () => { combatFx.update(120); powerFx.update(120); renderFrame(); };
  (window as unknown as Record<string, unknown>).__cast = (power: string, x: number, y: number) => {
    queue.enqueue(sim.tick + 1, { type: "cast_power", playerId: 0, power, x: x * FP_ONE, y: y * FP_ONE });
  };
  (window as unknown as Record<string, unknown>).__agePanel = agePanel;
  (window as unknown as Record<string, unknown>).__cmd = (cmd: Record<string, unknown>) =>
    queue.enqueue(sim.tick + 1, cmd as never);
  (window as unknown as Record<string, unknown>).__view = () => {
    refreshViews();
    return { units: unitView, buildings: buildingView, nodes: nodeView };
  };
  (window as unknown as Record<string, unknown>).__spawn = (playerId: number, unit: string, x: number, y: number) =>
    spawnUnitEntity(sim, playerId, unit, x * FP_ONE, y * FP_ONE);
  if (params.has("paused")) renderFrame(); // after ALL UI closures exist
  (window as unknown as Record<string, unknown>).__step = (n: number) => {
    for (let i = 0; i < n; i++) {
      aiService?.decideSyncNow(sim, queue);
      stepSim(sim, queue.drain(sim.tick));
      if (i >= n - 3) combatFx.collect(sim.events, world.groundHeightAt); // only recent FX
      powerFx.collect(sim.events, world.groundHeightAt);
      audio.collect(sim.events);
      collectNotifications();
    }
    checksum = simChecksum(sim);
  };
}

void boot();
