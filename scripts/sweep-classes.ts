/**
 * Class sweep: rewrite one design-system class to another across src/.
 *
 *   npx tsx scripts/sweep-classes.ts            # dry run, prints the diff count
 *   npx tsx scripts/sweep-classes.ts --apply    # writes
 *
 * The house rule (popular-web-designs/SKILL.md) is that a restyle touching
 * many files goes through an explicit old -> new mapping table rather than 30
 * hand edits, so the change is reviewable as a table and reproducible.
 *
 * `src/app/print/` is deliberately EXCLUDED. Those pages are A4-critical and
 * carry legal text (contract, demand letter, amendment); their type sizes were
 * chosen against paper, not a phone, and must not be swept with the app.
 */
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ROOT = path.join(process.cwd(), "src");
const EXCLUDE = [path.join("src", "app", "print")];

/** old -> new. Plain string replacement, applied in order. */
const MAP: Array<[string, string, string]> = [
  // [from, to, why]
  ["text-[9px]", "text-micro", "below legibility on a phone"],
  ["text-[10px]", "text-micro", "most common one-off; folds into the floor"],
  ["text-[11px]", "text-micro", "already the floor value, now a token"],
  ["text-[13px]", "text-sm", "closest step on the real scale"],
  ["font-display ", "", "aliased to the body font — rendered as nothing"],
  [" font-display", "", "same, trailing position"],
];

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (EXCLUDE.some((x) => p.includes(x))) return [];
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });

let filesChanged = 0;
const tally = new Map<string, number>();

for (const file of walk(ROOT)) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;
  for (const [from, to] of MAP) {
    if (!after.includes(from)) continue;
    const n = after.split(from).length - 1;
    tally.set(from, (tally.get(from) ?? 0) + n);
    after = after.split(from).join(to);
  }
  if (after === before) continue;
  filesChanged++;
  console.log(`  ${path.relative(process.cwd(), file)}`);
  if (APPLY) fs.writeFileSync(file, after);
}

console.log(`\n${"from".padEnd(20)} ${"to".padEnd(12)} count   why`);
for (const [from, to, why] of MAP) {
  const n = tally.get(from) ?? 0;
  if (n) console.log(`${from.padEnd(20)} ${(to || "(removed)").padEnd(12)} ${String(n).padStart(5)}   ${why}`);
}
console.log(
  `\n${filesChanged} file(s) ${APPLY ? "rewritten" : "would change"}. ` +
    (APPLY ? "" : "Re-run with --apply to write.")
);
