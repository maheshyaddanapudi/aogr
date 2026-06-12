/**
 * Bottom HUD: selection panel (left) + command card (right). Villagers expose
 * build buttons (entering placement-ghost mode); production buildings expose
 * train buttons; every action goes through the command queue.
 */
import { listBuildingIds, getBuildingStats } from "../sim/buildingdata";
import { getUnitStats } from "../sim/unitdata";
import { getMinor } from "../sim/pantheondata";
import { AGE_INDEX } from "../sim/techdata";
import type { Sim } from "../sim";

export interface CardCallbacks {
  onBuild: (buildingId: string) => void; // enter placement mode
  onTrain: (buildingEid: number, unitId: string) => void;
  onDeselect: () => void;
}

export interface CommandCard {
  refresh: (
    sim: Sim,
    playerId: number,
    selectedUnits: ReadonlyArray<{ eid: number; unitClass: string; name: string; hp: number; maxHp: number }>,
    selectedBuilding: { eid: number; buildingId: string } | null,
  ) => void;
}

const VILLAGER_BUILDS = ["house", "farm", "granary", "storehouse", "temple", "barracks", "archery_range", "stable", "armory", "market", "tower"];

export function createCommandCard(root: HTMLElement, cb: CardCallbacks): CommandCard {
  const panel = document.createElement("div");
  panel.className = "bottom-panel";
  panel.innerHTML = `
    <div class="sel-panel">
      <button class="sel-clear" title="Deselect" style="display:none">✕</button>
      <h3>Nothing selected</h3><div class="sel-body"></div>
    </div>
    <div class="command-card"></div>`;
  root.appendChild(panel);
  const selTitle = panel.querySelector<HTMLElement>(".sel-panel h3")!;
  const selBody = panel.querySelector<HTMLElement>(".sel-body")!;
  const selClear = panel.querySelector<HTMLButtonElement>(".sel-clear")!;
  const card = panel.querySelector<HTMLElement>(".command-card")!;
  selClear.addEventListener("click", () => cb.onDeselect());
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const rallyHint = coarse ? "Tap the map to set a rally point" : "Right-click the map to set a rally point";

  let lastKey = "";

  return {
    refresh(sim, playerId, units, building) {
      const p = sim.players[playerId]!;
      const key = `${units.map((u) => u.eid).join(",")}|${building?.eid ?? -1}|${p.age}`;
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
        for (const id of VILLAGER_BUILDS) {
          if (!listBuildingIds().includes(id)) continue;
          const stats = getBuildingStats(id);
          const ageOk = (AGE_INDEX[stats.age] ?? 0) <= p.age;
          const afford =
            p.foodMilli >= stats.cost.food * 1000 &&
            p.woodMilli >= stats.cost.wood * 1000 &&
            p.goldMilli >= stats.cost.gold * 1000;
          addBtn(stats.name, `${stats.name} — ${stats.cost.wood}w ${stats.cost.gold}g`, () => cb.onBuild(id), ageOk && afford);
        }
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
      }
    },
  };
}
