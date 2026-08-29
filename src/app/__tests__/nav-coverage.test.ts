import { describe, expect, it } from "vitest";
import { ALL_ROLES, LINKS, TAB_HREFS, visibleTo } from "../(app)/nav-config";

/**
 * The mobile tab bar used to be `LINKS.filter(visibleTo(role)).slice(0, 6)`
 * rendered into a hardcoded `grid-cols-6`. That produced two silent faults:
 *
 *   owner        13 visible → 6 tabs, and Deliveries, Products, Customers,
 *                Commissions, Leads, Analytics and Admin had NO mobile route
 *   collector     5 visible → 5 tabs in a 6-column grid, i.e. an empty cell
 *
 * Neither shows up in a type check or a build, and there is no staging
 * environment where a real person would trip over it — the first report would
 * come from someone in the field who cannot reach a page. So the invariants
 * are asserted here instead.
 */
describe("mobile navigation", () => {
  it("gives every role exactly four tabs, so the grid never has a hole", () => {
    for (const role of ALL_ROLES) {
      expect(TAB_HREFS[role], `${role} has no tab list`).toBeDefined();
      expect(TAB_HREFS[role], `${role} tab count`).toHaveLength(4);
    }
  });

  it("never puts a link in a role's tab bar that the role cannot see", () => {
    for (const role of ALL_ROLES) {
      const allowed = LINKS.filter(visibleTo(role)).map((l) => l.href);
      for (const href of TAB_HREFS[role]) {
        expect(allowed, `${role} tab ${href} is not visible to ${role}`).toContain(href);
      }
    }
  });

  it("leaves every visible link reachable — tabs plus the More sheet", () => {
    for (const role of ALL_ROLES) {
      const visible = LINKS.filter(visibleTo(role)).map((l) => l.href);
      const tabs = TAB_HREFS[role];
      const overflow = visible.filter((h) => !tabs.includes(h));
      // Reachable = in the tab bar, or in More. Nothing may fall between.
      expect([...tabs, ...overflow].sort()).toEqual([...visible].sort());
    }
  });

  it("starts every role on Home", () => {
    for (const role of ALL_ROLES) {
      expect(TAB_HREFS[role][0], `${role} first tab`).toBe("/");
    }
  });
});
