#!/usr/bin/env node
/**
 * Determinism guard (KICKOFF.md §3): src/sim/ must stay pure.
 *  - no imports from src/render, src/ui, @babylonjs, howler, or DOM usage
 *  - no Math.random
 *  - no performance.now / Date.now (wall-clock leaks)
 * Used three ways: `npm run check:determinism-rules`, CI, and the
 * .claude/hooks PostToolUse hook. Exits non-zero with a report on violation.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const SIM_DIR = new URL("../src/sim", import.meta.url).pathname;

const RULES = [
  { re: /from\s+["'][^"']*(\/render\/|\/ui\/|\.\.\/render|\.\.\/ui)[^"']*["']/, msg: "sim must not import from src/render or src/ui" },
  { re: /from\s+["']@babylonjs/, msg: "sim must not import Babylon" },
  { re: /from\s+["']howler["']/, msg: "sim must not import Howler" },
  { re: /\bMath\.random\b/, msg: "Math.random is banned in sim — use the seeded Prng" },
  { re: /\bperformance\.now\b/, msg: "wall-clock time is banned in sim" },
  { re: /\bDate\.now\b/, msg: "wall-clock time is banned in sim" },
  { re: /\bdocument\.|\bwindow\.|\bnavigator\./, msg: "DOM/browser globals are banned in sim" },
];

export function checkSimPurity(dir = SIM_DIR) {
  const violations = [];
  if (!existsSync(dir)) return violations;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|mts|mjs)$/.test(name)) {
        const lines = readFileSync(p, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (/^\s*(\/\/|\*)/.test(line)) return; // skip comments
          for (const rule of RULES) {
            if (rule.re.test(line)) {
              violations.push({ file: relative(join(dir, ".."), p), line: i + 1, msg: rule.msg, src: line.trim() });
            }
          }
        });
      }
    }
  };
  walk(dir);
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = checkSimPurity();
  if (violations.length) {
    console.error("DETERMINISM GUARD FAILED — src/sim purity violations:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.msg}\n    > ${v.src}`);
    process.exit(1);
  }
  console.log("sim purity OK");
}
