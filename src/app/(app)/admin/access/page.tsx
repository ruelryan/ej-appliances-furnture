import Link from "next/link";
import { redirect } from "next/navigation";
import { getRealProfile } from "@/lib/supabase/server";
import { SectionCard } from "@/components/section-card";
import { Alert } from "@/components/alert";
import { BackLink } from "@/components/back-link";
import { pageStack, theadRow, td } from "@/components/ui";

export const dynamic = "force-dynamic";

// The honest counterpart to "view as". The preview shows a role's SCREEN; this
// shows what the database will actually hand them, which is the question that
// matters for privacy and for trusting a staff member with an account.
//
// Sourced from docs/roles-and-permissions.md, which is itself verified against
// the RLS policies and the per-page gates. If those change, this changes with
// them in the same commit -- it is a claim about security, so a stale version
// is worse than none.

const DATA_ACCESS: {
  role: string;
  who: string;
  contracts: string;
  customers: string;
  money: string;
}[] = [
  {
    role: "Owner",
    who: "You, Elvira",
    contracts: "All",
    customers: "All",
    money: "All payments, analytics, exports",
  },
  {
    role: "Admin assistant",
    who: "Analyn",
    contracts: "All",
    customers: "All",
    money: "All payments. No analytics, no exports, no user admin",
  },
  {
    role: "Collector",
    who: "Roger",
    contracts: "Only those assigned to them",
    customers: "All — a deliberate choice, see the note below",
    money: "Only payments on their own assigned contracts",
  },
  {
    role: "Sales agent",
    who: "Nobody right now",
    contracts: "Only their own closed deals",
    customers: "Only customers on their own deals",
    money: "Only their own commissions",
  },
  {
    role: "Delivery",
    who: "Nobody right now",
    contracts: "All — needed to fulfil an order",
    customers: "All",
    money: "None",
  },
];

const CAN_WRITE: { role: string; can: string; cannot: string }[] = [
  {
    role: "Admin assistant",
    can: "Record and void payments, create contracts, post collectors' logs, record remittances, manage products, deliveries, suppliers and leads",
    cannot: "Edit a contract's price or term, close a contract, set repossession, see analytics, export data, manage users, finalise payroll",
  },
  {
    role: "Collector",
    can: "Log a collection visit, request a cash advance, tag GPS and landmarks for customers on their own worklist",
    cannot: "Record a payment — this is refused inside record_payment itself, not just hidden. Record or cancel a remittance; the office receives the cash, so the office records it",
  },
  {
    role: "Sales agent",
    can: "Submit a lead",
    cannot: "Anything else. It is read-only apart from leads, and cannot see other customers' details",
  },
  {
    role: "Delivery",
    can: "Mark stock availability and delivery, link a product to a delivery",
    cannot: "Touch money in any form",
  },
];

const OWNER_ONLY = [
  "Analytics",
  "User administration (/admin)",
  "Editing a contract's price or term",
  "Closing a contract",
  "Repossession stages",
  "CSV exports",
  "DTR settings and the geofence",
  "Finalising payroll, 13th-month pay",
];

export default async function AccessPage() {
  // getRealProfile, not getProfile: a page describing who can see what must not
  // itself be hidden by a preview the owner is running.
  const profile = await getRealProfile();
  if (profile?.role !== "owner") redirect("/");

  return (
    <div className={`mx-auto max-w-3xl ${pageStack}`}>
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
        <BackLink /> What each role can access
      </h1>

      <Alert tone="info">
        <span className="font-semibold">This is the real answer.</span> Viewing
        as someone shows you their screen, but the rows on it are still yours —
        the database identifies you by your login, not by the role you are
        previewing. This page describes what their login actually returns.
      </Alert>

      <SectionCard
        title="What they can see"
        sub="Enforced by the database, not by hiding menu items."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={theadRow}>
                <th className={td}>Role</th>
                <th className={td}>Who</th>
                <th className={td}>Contracts</th>
                <th className={td}>Customers</th>
                <th className={td}>Money</th>
              </tr>
            </thead>
            <tbody>
              {DATA_ACCESS.map((r) => (
                <tr key={r.role} className="border-b border-line align-top last:border-0">
                  <td className={`${td} font-semibold text-ink`}>{r.role}</td>
                  <td className={`${td} text-muted`}>{r.who}</td>
                  <td className={td}>{r.contracts}</td>
                  <td className={td}>{r.customers}</td>
                  <td className={td}>{r.money}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Why a collector sees every customer"
        sub="The one answer here that surprises people."
      >
        <p className="text-sm text-ink">
          A collector is shown the whole customer book, not just their own 24
          accounts. That was decided on purpose when collections were built: a
          collector standing at a door needs to identify whoever answers it, and
          an account can be reassigned mid-round. Their{" "}
          <span className="font-semibold">contracts</span> and{" "}
          <span className="font-semibold">payments</span> are still narrowed to
          the accounts assigned to them — it is the customer directory that is
          shared.
        </p>
        <p className="mt-2 text-sm text-muted">
          If that ever stops being acceptable, it is a change to the RLS policy
          on <span className="font-mono text-xs">customers</span>, not to a menu.
        </p>
      </SectionCard>

      <SectionCard title="What they can change">
        <div className="space-y-3">
          {CAN_WRITE.map((r) => (
            <div key={r.role} className="rounded-card bg-surface p-3">
              <div className="text-sm font-semibold text-ink">{r.role}</div>
              <p className="mt-1 text-sm text-ink">
                <span className="text-positive">Can:</span> {r.can}
              </p>
              <p className="mt-1 text-sm text-muted">
                <span className="text-danger">Cannot:</span> {r.cannot}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Yours alone" sub="No other role reaches these, in the UI or the database.">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {OWNER_ONLY.map((x) => (
            <li key={x} className="text-sm text-ink">
              {x}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="One thing worth knowing">
        <p className="text-sm text-ink">
          Hiding a menu item does not protect anything. Most pages in this app
          will load for any signed-in person; what stops them seeing another
          person&rsquo;s data is the database refusing to return the rows. That
          is why this page describes the database rather than the menus — and
          why a staff member who is no longer with you should be{" "}
          <Link href="/admin" className="font-medium text-brand hover:underline">
            deactivated on the Admin page
          </Link>
          , which cuts their access immediately even if their phone is still
          signed in.
        </p>
      </SectionCard>
    </div>
  );
}
