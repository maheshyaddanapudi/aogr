/**
 * Bottom HUD: selection panel (left) + command card (right). Villagers expose
 * build buttons (entering placement-ghost mode); production buildings expose
 * train buttons; every action goes through the command queue.
 */
import { listBuildingIds, getBuildingStats } from "../sim/buildingdata";
import { getUnitStats } from "../sim/unitdata";
import { getMinor } from "../sim/pantheondata";
import { AGE_INDEX, getTechStats, listTechIds } from "../sim/techdata";
import type { Sim } from "../sim";
import type { TrainEntry } from "../sim/economy";

export interface CardCallbacks {
  onBuild: (buildingId: string) => void; // enter placement mode
  onTrain: (buildingEid: number, unitId: string) => void;
  onResearch: (techId: string) => void;
  onCancelTrain: (buildingEid: number, index: number) => void;
  onStance: (stance: number) => void;
  onFormation: (formation: number) => void;
  onUngarrison: (buildingEid: number) => void;
  onDeselect: () => void;
}

export interface CommandCard {
  refresh: (
    sim: Sim,
    playerId: number,
    selectedUnits: ReadonlyArray<{ eid: number; unitClass: string; name: string; hp: number; maxHp: number }>,
    selectedBuilding: { eid: number; buildingId: string } | null,
    queue?: TrainEntry[] | null,
    garrisoned?: number,
  ) => void;
}

const VILLAGER_BUILDS = ["house", "farm", "granary", "storehouse", "temple", "barracks", "archery_range", "stable", "armory", "market", "dock", "tower", "wall", "gate", "fortress", "town_center", "wonder"];
/** each pantheon's own favor building joins the build menu */
const FAVOR_BUILDS: Record<string, string> = { auryan_dawn: "sun_altar", storm_concord: "sky_temple" };
const STANCES = [
  { v: 1, label: "Aggressive", hint: "Chase and fight anything in sight" },
  { v: 2, label: "Hold Ground", hint: "Fight what comes in reach; never chase" },
  { v: 0, label: "Passive", hint: "Never fight back" },
];

export function createCommandCard(root: HTMLElement, cb: CardCallbacks): CommandCard {
  const panel = document.createElement("div");
  panel.className = "bottom-panel";
  panel.innerHTML = `
    <div class="sel-panel">
      <button class="sel-clear" title="Deselect" style="display:none">✕</button>
      <h3>Nothing selected</h3><div class="sel-body"></div>
      <div class="queue-strip"></div>
    </div>
    <div class="command-card"></div>`;
  root.appendChild(panel);
  const selTitle = panel.querySelector<HTMLElement>(".sel-panel h3")!;
  const selBody = panel.querySelector<HTMLElement>(".sel-body")!;
  const selClear = panel.querySelector<HTMLButtonElement>(".sel-clear")!;
  const queueStrip = panel.querySelector<HTMLElement>(".queue-strip")!;
  const card = panel.querySelector<HTMLElement>(".command-card")!;
  selClear.addEventListener("click", () => cb.onDeselect());
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const rallyHint = coarse ? "Tap the map to set a rally point" : "Right-click the map to set a rally point";

  let lastKey = "";

  return {
    refresh(sim, playerId, units, building, queue, garrisoned) {
      const p = sim.players[playerId]!;
      // production queue (redraws every call — progress moves without clicks)
      if (building && queue && queue.length > 0) {
        queueStrip.style.display = "";
        queueStrip.innerHTML = "";
        queue.forEach((entry, i) => {
          const b = document.createElement("button");
          b.className = "queue-item";
          const total = getUnitStats(entry.unitId).trainTicks;
          const pct = i === 0 ? Math.round(((total - entry.ticksLeft) / Math.max(1, total)) * 100) : 0;
          b.innerHTML = `${getUnitStats(entry.unitId).name}${i === 0 ? ` <i>${pct}%</i>` : ""} ✕`;
          b.title = "Cancel (refunds cost)";
          b.addEventListener("click", () => cb.onCancelTrain(building.eid, i));
          queueStrip.appendChild(b);
        });
      } else {
        queueStrip.style.display = "none";
      }
      const key = `${garrisoned ?? 0}|${units.map((u) => u.eid).join(",")}|${building?.eid ?? -1}|${p.age}|${Math.trunc(p.foodMilli / 20000)}|${Math.trunc(p.woodMilli / 20000)}|${p.researchedTechs.length}|${p.researchQueue.length}`;
      // selection info refreshes every call; buttons only on change
      if (units.length > 0) {
        selTitle.textContent = units.length === 1 ? units[0]!.name : `${units.length} units`;
        const verb = coarse ? "Tap" : "Right-click";
        const hint = units.some((u) => u.unitClass === "villager")
          ? `<small class="sel-hint">${verb} trees/bushes/gold to gather, a farm to work it, ground to walk</small>`
          : `<small class="sel-hint">${verb} an enemy to attack, ground to move</small>`;
        selBody.innerHTML =
          (units.length === 1
            ? `<div class="hpbar"><i style="width:${Math.round((units[0]!.hp / units[0]!.maxHp) * 100)}%"></i></div><span>${units[0]!.hp}/${units[0]!.maxHp} HP</span>`
            : `<span>${units.map((u) => u.name).slice(0, 4).join(", ")}${units.length > 4 ? "…" : ""}</span>`) + hint;
      } else if (building) {
        const stats = getBuildingStats(building.buildingId);
        selTitle.textContent = stats.name;
        selBody.innerHTML = stats.trains.length > 0 ? `<span>${rallyHint}</span>` : "";
      } else {
        selTitle.textContent = "Nothing selected";
        selBody.innerHTML = "";
      }
      selClear.style.display = units.length > 0 || building ? "" : "none";
      if (key === lastKey) return;
      lastKey = key;
      card.innerHTML = "";

      const addBtn = (label: string, title: string, onClick: () => void, enabled: boolean) => {
        const b = document.createElement("button");
        b.className = "cmd-btn";
        b.textContent = label;
        b.title = title;
        b.disabled = !enabled;
        b.addEventListener("click", onClick);
        card.appendChild(b);
      };

      if (units.some((u) => u.unitClass === "villager")) {
        const buildList = [...VILLAGER_BUILDS];
        const favor = FAVOR_BUILDS[p.pantheon];
        if (favor) buildList.splice(5, 0, favor);
        for (const id of buildList) {
          if (!listBuildingIds().includes(id)) continue;
          const stats = getBuildingStats(id);
          const ageOk = (AGE_INDEX[stats.age] ?? 0) <= p.age;
          const afford =
            p.foodMilli >= stats.cost.food * 1000 &&
            p.woodMilli >= stats.cost.wood * 1000 &&
            p.goldMilli >= stats.cost.gold * 1000;
          addBtn(stats.name, `${stats.name} — ${stats.cost.wood}w ${stats.cost.gold}g`, () => cb.onBuild(id), ageOk && afford);
        }
      } else if (units.length > 0) {
        // military selection: stance controls
        for (const s of STANCES) addBtn(s.label, s.hint, () => cb.onStance(s.v), true);
        addBtn("Box Formation", "Group moves arrange in a compact square", () => cb.onFormation(0), true);
        addBtn("Line Formation", "Group moves string out in a battle line", () => cb.onFormation(1), true);
      } else if (building) {
        const stats = getBuildingStats(building.buildingId);
        const trains: string[] = [];
        for (const t of stats.trains) {
          if (t === "heroes") {
            trains.push(...["radiant_champion", "tide_seer", "forgeborn", "sky_herald"].filter((h) => getUnitStats(h).pantheon === p.pantheon));
          } else if (t === "myth_units") {
            for (const g of p.minorGods) {
              try {
                trains.push(...getMinor(p.pantheon, g).grants.mythUnits);
              } catch {
                /* other pantheon */
              }
            }
          } else trains.push(t);
        }
        for (const u of trains) {
          const us = getUnitStats(u);
          const ageOk = (AGE_INDEX[us.age] ?? 0) <= p.age;
          addBtn(us.name, `${us.name} — ${us.cost.food}f ${us.cost.gold}g ${us.cost.favor}fv · pop ${us.pop}`, () => cb.onTrain(building.eid, u), ageOk);
        }
        // techs researched at this building
        for (const tid of listTechIds()) {
          const t = getTechStats(tid);
          if (t.researchedAt !== building.buildingId || tid.startsWith("age_")) continue;
          if (p.researchedTechs.includes(tid) || p.researchQueue.some((r) => r.techId === tid)) continue;
          if ((AGE_INDEX[t.age] ?? 0) > p.age) continue;
          const afford =
            p.foodMilli >= t.cost.food * 1000 && p.woodMilli >= t.cost.wood * 1000 &&
            p.goldMilli >= t.cost.gold * 1000 && p.favorMilli >= t.cost.favor * 1000;
          addBtn(`🔬 ${t.name}`, `${t.name} — ${t.cost.food}f ${t.cost.wood}w ${t.cost.gold}g ${t.cost.favor}fv`, () => cb.onResearch(tid), afford);
        }
        if ((garrisoned ?? 0) > 0) {
          addBtn(`Ungarrison (${garrisoned})`, "Release all sheltered units", () => cb.onUngarrison(building.eid), true);
        }
      }
    },
  };
}
