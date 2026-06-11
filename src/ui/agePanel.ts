/**
 * Age-up choice panel: two minor-god cards (per the chosen major god's pool),
 * bronze/parchment with pantheon color identity and hover glow. Choosing a
 * god enqueues the research command — the panel never touches the sim.
 */
import { getMinor, getMinorPool, getPantheon } from "../sim/pantheondata";
import godpowersJson from "../../data/godpowers.json";
import unitsJson from "../../data/units.json";

const AGE_TECH: Record<string, string> = {
  classical: "age_classical",
  heroic: "age_heroic",
  mythic: "age_mythic",
};

export interface AgePanel {
  show: (pantheonId: string, majorId: string, tier: "classical" | "heroic" | "mythic") => void;
  hide: () => void;
  readonly isOpen: () => boolean;
}

export function createAgePanel(onChoose: (tech: string, minorGod: string) => void): AgePanel {
  const overlay = document.createElement("div");
  overlay.className = "age-overlay";
  overlay.style.display = "none";
  document.body.appendChild(overlay);

  const powers = (godpowersJson as { powers: Record<string, { name: string; description: string }> }).powers;
  const units = (unitsJson as { units: Record<string, { name: string }> }).units;

  const show: AgePanel["show"] = (pantheonId, majorId, tier) => {
    const pantheon = getPantheon(pantheonId);
    const pool = getMinorPool(pantheonId, majorId, tier);
    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
    overlay.innerHTML = `
      <div class="age-panel" style="--pantheon: ${pantheon.colorIdentity}">
        <h1>Advance to the ${tierName} Age</h1>
        <p class="age-sub">${pantheon.name} — choose a patron for this age</p>
        <div class="god-cards"></div>
      </div>`;
    const cardHost = overlay.querySelector(".god-cards")!;
    for (const minorId of pool) {
      const minor = getMinor(pantheonId, minorId);
      const power = powers[minor.grants.power];
      const mythNames = minor.grants.mythUnits.map((u) => units[u]?.name ?? u);
      const card = document.createElement("button");
      card.className = "god-card";
      card.innerHTML = `
        <h2>${minor.name}</h2>
        <h3>${minor.title}</h3>
        <ul>
          <li><b>Power</b> ${power?.name ?? minor.grants.power}</li>
          ${mythNames.length ? `<li><b>Myth</b> ${mythNames.join(", ")}</li>` : ""}
          <li><b>Tech</b> ${minor.grants.techs.join(", ").replaceAll("_", " ")}</li>
        </ul>
        <p class="god-blurb">${power?.description ?? ""}</p>`;
      card.addEventListener("click", () => {
        onChoose(AGE_TECH[tier]!, minorId);
        hide();
      });
      cardHost.appendChild(card);
    }
    overlay.style.display = "flex";
  };

  const hide = () => {
    overlay.style.display = "none";
  };

  return { show, hide, isOpen: () => overlay.style.display !== "none" };
}
