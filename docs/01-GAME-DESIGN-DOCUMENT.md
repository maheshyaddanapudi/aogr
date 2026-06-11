# 01 — GAME DESIGN DOCUMENT

This is the full expansion of KICKOFF §6. **Numbers shown here are design intent;
`data/*.json` is the binding source of truth.** When this doc and the data files
disagree, the data files win and this doc gets corrected.

---

## 1. Resources & Economy

Four resources: **food, wood, gold, favor**.

- **Food** — hunting (≈1.0/s base), foraging (0.8/s), farms (0.75/s, infinite),
  fishing (0.9/s villager, 1.1/s boat). Trained units mostly cost food.
- **Wood** — trees (0.85/s). Buildings, archers, siege.
- **Gold** — mines (0.9/s, finite) and market caravans. Elite units, techs, trade.
- **Favor** — earned through each pantheon's unique mechanic (§4 below). Spent on
  myth units, minor-god techs, and god-power recasts. **Never tradeable.**

Drop-off: Town Center accepts all; Granary (food), Storehouse (wood+gold), Dock (fish).
Market trades food/wood/gold with a 15% spread (Silver Tongues narrows it); caravans
generate gold proportional to distance from Town Center.

**Population:** cap 300. Town Center +15, House +10 (build limit 10). Start: 1 Town
Center, 4 villagers, 1 scout, 200f/200w/100g.

## 2. Ages

| Age | Cost | Prerequisite building | Unlocks |
|-----|------|----------------------|---------|
| Archaic | start | — | Villagers, scout, houses, farms, temple, dock, eco buildings |
| Classical | 400 food | Temple | Military buildings + units, heroes, classical myth/minor gods |
| Heroic | 800 food + 500 gold | Armory | Fortress, market, raiders, rams, heroic minors |
| Mythic | 1000 food + 1000 gold | Market | Wonder, catapults, caravans, mythic minors |

Each age-up is researched at the Town Center and presents a **choice of 2 minor gods**
from the chosen major god's pool. A minor god permanently grants: 1 god power,
1 unique tech, and (for 4 of the 6 per pantheon) a myth unit line.

## 3. Combat Model

**Damage types:** hack, pierce, crush, **divine** (divine ignores armor).
**Armor** = % damage reduction per type. Armor techs add percentage points
(reducing vulnerability). Units have ~99% crush armor; buildings ~5% — siege exists
to kill buildings, not soldiers.

`damage = max(1, attackDamage × multiplier(targetClassOrId) × (1 − armor%[type]))`
(computed in fixed-point ×100; minimum 1 point per hit).

**Human counter triangle** (soft counters via multipliers in `units.json`):
infantry → beaten by archers (×1.5 vs infantry) → beaten by cavalry (×1.25 vs
archers) → beaten by infantry (×1.25 vs cavalry). Hard counters: **Spear Levy ×3 vs
cavalry**, **Skirmisher ×4 vs archers**.

**Three-way class triangle:**
- **Myth units** are strong vs humans (raw stats + per-unit multipliers).
- **Heroes** deal divine damage, ×2–2.5 vs myth, and are **immune to myth special
  attacks** (petrify, toss, snatch).
- **Humans** are cost-efficient vs heroes (heroes are expensive and few).

## 4. The Four Pantheons

Shared military archetypes (one stat line in `units.json`, flavor names per pantheon
via `pantheons.json/unitNames`): Line Infantry, Spear Levy, Bow Guard, Skirmisher,
Lance Cavalry, Raider, Siege Ram, Stone Thrower.

### 4.1 The Auryan Dawn *(solar / order — gold #e8a83c)*

**Favor — Devotion Pyres:** up to 5 Sun-Altars radiate favor passively at escalating
rates (2.0 / 3.6 / 5.2 / 7.4 / 10.4 per minute; 28.6/min with all five — the
monument-style §7 calibration). The **Radiant Champion** hero can kindle an altar:
×2 favor for 30s.

| Major | Title | Domain | Passives |
|-------|-------|--------|----------|
| **Suryan** | The Unsetting Sun | sun, kingship | Sun-Altars −25% cost; villagers +5% gather near altars |
| **Khorath** | The Iron Decree | order, war | Infantry +10% HP; towers/walls build 25% faster |
| **Vaishtar** | The First Light | dawn, renewal | Heroes regenerate; age-up research 15% faster |

| Minor (age) | Grants: power | Myth unit | Tech |
|-------------|---------------|-----------|------|
| Helior (Classical) | Solar Lance — divine bolt at a point | **Sunhawk** (flying harasser, ×1.5 vs archers) | Gilded Quivers |
| Anshara (Classical) | Golden Flood — farm/forage income ×2 for 30s | **Sandlion** (tornado-breath crush splash) | Golden Harvest |
| Mithrun (Heroic) | Pyre Storm — falling embers DoT area | **Emberbull** (§7 anchor: 300 HP, 15 hack + 10 crush, ×3 vs myth) | Pyre Brands |
| Ravas (Heroic) | Searing Mirage — blinds enemy ranged units | — | Searing Zeal (Sandlion +25% dmg) |
| Aurion (Mythic) | Risen Champion — summons empowered hero | **Ashen Phoenix** (resurrects once, divine splash) | Eternal Flame |
| Kaelios (Mythic) | Aegis of Dawn — buildings invulnerable 20s | — | Meridian Order (+5% all gather) |

### 4.2 The Verdant Deep *(water / storm / nature — teal #2e8f7a)*

**Favor — Tidal Oracles:** the **Tide-Seer** hero generates favor while stationary,
scaling with LOS radius (5.5/min at base 18 LOS); overlapping radii don't stack —
spread your seers.

| Major | Title | Domain | Passives |
|-------|-------|--------|----------|
| **Varendra** | The Worldriver | rivers, growth | Farms −20% cost; fishing boats +10% |
| **Oyandi** | The Stormcaller | storms, sea-war | Myth units +10% speed; powers recharge 10% faster |
| **Oshara** | The Deep Mother | depths, secrets | Tide-Seers +4 LOS; enemies revealed in your territory |

| Minor (age) | Grants: power | Myth unit | Tech |
|-------------|---------------|-----------|------|
| Nereon (Classical) | Lure of Tides — attracts game, schools fish | **Rivermaw** (+2 dmg per 3 kills, max +6) | Tidal Bounty |
| Lirassa (Classical) | Cleansing Rain — heal + cure debuffs | — | Spring Blessing (heroes +10% HP) |
| Thalor (Heroic) | Floodsurge — crush wave down a line | **Stormserpent** (lightning arcs every 4th hit) | Storm Coils |
| Undvara (Heroic) | Mistveil — conceals friendly units | **Deepcaller Naiad** (ranged petrify) | Veiled Currents |
| Okeanor (Mythic) | Maelstrom — pulling divine vortex | **Coral Golem** (tank; regenerates in shallows) | Abyssal Plate |
| Sirath (Mythic) | Kelpward — roots enemies in place | — | Hydra Heads (Rivermaw +25% dmg) |

### 4.3 The Ashen Forge *(fire / earth / craft / war — rust #b8472e)*

**Favor — Forge-Wrath:** favor from combat damage dealt (0.012 favor per damage
point). The **Forgeborn** hero trickles 1.8 favor/min passively; the *Forgeborn
Ascendant* tech doubles all combat favor.

| Major | Title | Domain | Passives |
|-------|-------|--------|----------|
| **Ogarun** | The Worldsmith | forge, craft | Armory techs −20%; siege +10% HP |
| **Shangor** | The War-Anvil | war, fury | Combat favor +15%; barracks train 10% faster |
| **Drauvik** | The Mountain's Root | earth, endurance | Buildings +15% HP; gold miners +5% |

| Minor (age) | Grants: power | Myth unit | Tech |
|-------------|---------------|-----------|------|
| Hesmir (Classical) | Ironhide — +15% armor in area | **Forgehound** (burning bite DoT) | Hearth Iron |
| Brandvar (Classical) | Flaming Weapons — all soldiers +3 divine dmg | — | Smelter's Creed (+10% combat favor) |
| Tarkun (Heroic) | Vajra Bolt — single-target execute + chain | **Thunder Jotun** (stunning slam, ×2 vs siege) | Storm Anvils |
| Velgar (Heroic) | Forge-Quake — crush quake, ×3 vs buildings | **Cyclorn** (throws enemy soldiers) | Quake Fists |
| Morvath (Mythic) | Call of the Last War — villagers fight as heroes 45s | — | Forgeborn Ascendant (×2 combat favor) |
| Khaldun (Mythic) | Molten Rampart — magma wall on a line | **Bronze Colossus** (eats trees/gold to heal) | Living Bronze |

### 4.4 The Storm Concord *(sky / heavens / trickster — indigo #5a6fc7)*

**Favor — Skyward Chants:** villagers pray at Sky-Temples. First worshipper 6/min
(§7 prayer calibration), each additional ×0.85, max 10 worshippers.

| Major | Title | Domain | Passives |
|-------|-------|--------|----------|
| **Indravan** | King of the High Sky | lightning, sovereignty | Power damage +15%; Sky-Temples −20% |
| **Vayuna** | The Endless Wind | wind, journeys | All units +5% speed; free scout LOS upgrade |
| **Eshura** | The Laughing Veil | trickery, fate | Market +10% better trades; enemy powers +10% favor cost |

| Minor (age) | Grants: power | Myth unit | Tech |
|-------------|---------------|-----------|------|
| Zephyrion (Classical) | Clarity — reveal whole map 15s | **Garuhawk** (flying, snatches villagers, ×1.5 vs siege) | Zephyr Wings |
| Anila (Classical) | Crosswinds — area +50% move speed | — | Tailwind (archers +10% speed) |
| Maruth (Heroic) | Tempest — hail area, slows + pierces | **Wind Djinn** (whirlwind spread damage) | Gale Force |
| Vrithra (Heroic) | Mirrored Skies — illusory decoy army | **Stonegaze Naga** (ranged petrify) | Serpent's Sight |
| Kethran (Mythic) | Trickster's Gift — permanently convert 1 enemy unit | — | Silver Tongues (market spread −5) |
| Ashvayu (Mythic) | Sovereign Bolt — 400 divine execute + area stun | **Sky Manticore** (flying spike volleys) | Crown of Storms |

## 5. God Powers

All powers are **reusable**: first cast free, then `baseFavorCost`, ramping
**+50% per recast** (cost(n) = base × 1.5^(n−1), fixed-point rounded). Each has an
independent cooldown. Full parameters in `data/godpowers.json` (6 per pantheon, 24 total).

## 6. Heroes

One hero line per pantheon (Radiant Champion / Tide-Seer / Forgeborn / Sky Herald),
trained at the Temple from Classical age, capped at 4 alive (design intent; enforced
Phase 6). Heroes deal divine damage, counter myth ×2–2.5, are immune to myth special
attacks, and each carries its pantheon's favor-mechanic special. Heroes also pick up
**relics** (garrisoned at the Temple for trickle bonuses + relic victory).

## 7. Buildings

See `data/buildings.json`. Notables: Town Centers build only on **settlement
sockets** (map-generated, fixed count — they are the territorial victory objective);
Wonder (Mythic, 1000/1000/1000) starts a **10-minute victory countdown**; Sun-Altar
(Auryan, limit 5) and Sky-Temple (Storm) are favor buildings. Buildings show
construction states (scaffold→partial→complete) and damage states (smoke <50%,
fire <25%).

## 8. Victory Conditions

1. **Conquest** (default): destroy all enemy Town Centers + military production.
2. **Wonder**: build a Wonder and hold it through the 10-minute countdown.
3. **Settlement control**: hold all settlement sockets on the map for 5 minutes, OR
   garrison all 5 relics in your temples for 10 minutes.

## 9. Random Maps

Seed-driven generation inside the sim (`data/maps/*.json` configs): 200×200 tiles,
mirrored fair starts, settlement sockets, forests/mines/herds per player, lakes with
fish, 5 relics. First map: **Sunlit Plains**. Fog of war: unexplored (black),
explored (dimmed, buildings remembered), visible (live).

## 10. Tuning Doctrine

§7 anchors are immovable reference points. Tune outward from them in `data/*.json`
only, with the headless counter-triangle tests as the regression net (Phase 4+).
