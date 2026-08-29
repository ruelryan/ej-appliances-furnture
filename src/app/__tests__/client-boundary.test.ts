import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A Server Component may import a *component* from a "use client" module —
 * that is the whole point of the boundary. It may NOT import a plain value.
 * Next replaces every export of a client module with a client-reference proxy,
 * so on the server the array/object is not there:
 *
 *   TypeError: h.TEAM_OPTIONS.find is not a function   (/tasks, 2026-07-27..08-27)
 *
 * That one broke the Tasks page for a month for the only user whose worklist
 * contained a team-assigned task — the single branch that read the constant.
 * It type-checks, it builds, and `npm run dev` is happy; only the production
 * RSC bundle shows it. Hence a structural test rather than a runtime one.
 *
 * `import type` is erased before it reaches the bundler and is always fine.
 */

const SRC = path.join(process.cwd(), "src");

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });

const isClientModule = (file: string) =>
  /^\s*["']use client["']/.test(fs.readFileSync(file, "utf8"));

/** Mirrors the `@/` alias and extension resolution well enough for src/. */
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  const candidates = [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function valueImportsFromClientModules(file: string) {
  const src = fs.readFileSync(file, "utf8");
  const found: string[] = [];
  // Named-import clauses only; `import type {...}` is skipped outright.
  const re = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) {
    if (m[1]) continue; // import type { ... }
    const target = resolveImport(file, m[3]);
    if (!target || !isClientModule(target)) continue;
    const names = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("type ")) // inline type specifier
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    // PascalCase = a component, which is exactly what the boundary is for.
    const values = names.filter((n) => !/^[A-Z][a-zA-Z0-9]*$/.test(n));
    for (const v of values) {
      found.push(`${path.relative(process.cwd(), file)} imports \`${v}\` from ${path.relative(process.cwd(), target)}`);
    }
  }
  return found;
}

describe("client/server module boundary", () => {
  it("no Server Component imports a plain value from a \"use client\" module", () => {
    const violations = walk(SRC)
      .filter((f) => !isClientModule(f))
      .flatMap(valueImportsFromClientModules);
    expect(violations).toEqual([]);
  });
});
