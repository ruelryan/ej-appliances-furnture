import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso, fmtDateShort, phTodayISO } from "@/lib/format";
import { buildFollowupMessage, type ContractFinancials } from "@/lib/messages";
import { TierBadge } from "@/components/tier-badge";
import { CopyButton } from "@/components/copy-button";
import { SectionCard } from "@/components/section-card";
import { StatTile } from "@/components/stat-tile";
import { LogCollectionDialog } from "./log-collection-dialog";
import { PostEntryDialog } from "./post-entry-dialog";
import { CancelEntryButton } from "./cancel-entry-button";
import { AssignDialog } from "./assign-dialog";
import {
  RequestAdvanceButton,
  IssueAdvanceButton,
  AddExpenseButton,
  ApproveDeclineButtons,
  CloseAdvanceButton,
} from "./advance-actions";

export const dynamic = "force-dynamic";

const DISPOSITION_LABELS: Record<string, string> = {
  collected: "Collected",
  promised: "Promised",
  not_available: "Not available",
  refused: "Refused",
};

export default async function CollectionsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const role = profile.role;
  const isCollector = role === "collector";
  const canPost = role === "owner" || role === "admin" || role === "staff";
  if (!isCollector && !canPost) redirect("/"); // sales_agent / delivery

  return isCollector ? <CollectorBoard /> : <AdminBoard />;
}

// ─────────────────────────────────────────────────────────────
// Collector: assigned worklist + log + own advances
// ─────────────────────────────────────────────────────────────
async function CollectorBoard() {
  const supabase = await createClient();
  const today = phTodayISO();

  const [{ data: worklist }, { data: entries }, { data: advances }] =
    await Promise.all([
      supabase
        .from("v_contract_collections")
        .select("*")
        .eq("payment_status", "open")
        .order("collection_priority", { ascending: true, nullsFirst: false })
        .order("overdue_amount", { ascending: false }),
      supabase
        .from("collection_entries")
        .select(
          "*, contract:contracts(contract_no, customer:customers(display_name))"
        )
        .eq("work_date", today)
        .order("created_at", { ascending: false }),
      supabase
        .from("cash_advances")
        .select("*, cash_advance_expenses(amount)")
        .in("status", ["requested", "open"])
        .order("requested_at", { ascending: false }),
    ]);

  const todayEntries = entries ?? [];
  const cashToday = todayEntries
    .filter((e) => e.method === "cash" && e.status !== "cancelled")
    .reduce((s, e) => s + Number(e.amount), 0);
  const onlineToday = todayEntries
    .filter((e) => e.method === "online" && e.status !== "cancelled")
    .reduce((s, e) => s + Number(e.amount), 0);
  const openAdvances = (advances ?? []).filter((a) => a.status === "open");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">My collections</h1>
        <Link
          href="/collections/report"
          className="rounded-card border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
        >
          Daily report
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Assigned" value={String((worklist ?? []).length)} />
        <StatTile label="Cash today" value={peso(cashToday)} />
        <StatTile label="Online today" value={peso(onlineToday)} />
      </div>

      <SectionCard
        title="Worklist"
        sub="Your assigned accounts, highest priority first. Log each visit."
      >
        <div className="space-y-3">
          {(worklist ?? []).map((c) => {
            const msg = buildFollowupMessage(c as ContractFinancials);
            return (
              <div
                key={c.id}
                className="rounded-card border border-line p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/contracts/${c.id}`}
                      className="font-display font-semibold text-ink hover:underline"
                    >
                      {c.display_name}
                    </Link>
                    <div className="truncate text-xs text-muted">
                      #{c.contract_no} · {c.item_description}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Last payment:{" "}
                      {c.last_payment_date
                        ? fmtDateShort(c.last_payment_date)
                        : "never"}
                      {c.collection_priority
                        ? ` · priority ${c.collection_priority}`
                        : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <TierBadge tier={c.followup_tier} />
                    <div className="mt-1 text-sm font-semibold text-danger">
                      {peso(c.overdue_amount)}
                    </div>
                    <div className="text-[11px] text-muted">past due</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <LogCollectionDialog
                    contractId={c.id}
                    customerName={c.display_name}
                  />
                  <CopyButton text={msg} label="Copy message" />
                  {/* Collectors get the group chat only — collection talk belongs
                      where the owner and admin can see it. The customer's personal
                      Messenger stays on the contract/customer pages. */}
                  {c.collection_gc_url && (
                    <a
                      href={c.collection_gc_url}
                      target="_blank"
                      className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
                    >
                      Group chat
                    </a>
                  )}
                  {c.gps_url && (
                    <a
                      href={c.gps_url}
                      target="_blank"
                      className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
                    >
                      Map
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {(worklist ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted">
              No accounts assigned to you yet.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Logged today"
        sub="Entries you logged today. The admin posts collected entries as payments."
      >
        <EntryList entries={todayEntries} showCollector={false} />
      </SectionCard>

      <SectionCard
        title="Cash advances"
        action={<RequestAdvanceButton />}
        sub="Ask for gasoline / expense money, then add receipts to close it."
      >
        <AdvanceList advances={advances ?? []} canManage={false} />
        {openAdvances.length === 0 && (advances ?? []).length === 0 && (
          <p className="py-4 text-center text-sm text-muted">
            No advances yet.
          </p>
        )}
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Owner / admin: to-post queue, activity, advances, assignment
// ─────────────────────────────────────────────────────────────
async function AdminBoard() {
  const supabase = await createClient();
  const today = phTodayISO();

  const [
    { data: pending },
    { data: collectors },
    { data: dayRollup },
    { data: advances },
    { data: worklist },
  ] = await Promise.all([
    supabase
      .from("collection_entries")
      .select(
        "*, contract:contracts(contract_no, item_type, customer:customers(display_name))"
      )
      .eq("status", "pending")
      .eq("disposition", "collected")
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "collector")
      .eq("active", true)
      .order("full_name"),
    supabase.from("v_collector_day").select("*").eq("work_date", today),
    supabase
      .from("cash_advances")
      .select("*, cash_advance_expenses(amount)")
      .in("status", ["requested", "open"])
      .order("requested_at", { ascending: false }),
    supabase
      .from("v_contract_collections")
      .select("*")
      .eq("payment_status", "open")
      .in("followup_tier", ["overdue", "demand"])
      .order("overdue_amount", { ascending: false })
      .limit(60),
  ]);

  const collectorList = collectors ?? [];
  const collectorName = (id: string | null) =>
    collectorList.find((c) => c.id === id)?.full_name ?? "—";
  const pendingTotal = (pending ?? []).reduce(
    (s, e) => s + Number(e.amount),
    0
  );
  const requests = (advances ?? []).filter((a) => a.status === "requested");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Collections</h1>
        <Link
          href="/collections/report"
          className="rounded-card border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
        >
          Daily report
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="To post" value={String((pending ?? []).length)} />
        <StatTile label="Pending amount" value={peso(pendingTotal)} />
        <StatTile
          label="Advance requests"
          value={String(requests.length)}
          alert={requests.length > 0}
        />
        <StatTile
          label="Collectors active"
          value={String(collectorList.length)}
        />
      </div>

      {/* To-post queue */}
      <SectionCard
        title="To post"
        sub="Collected entries logged by collectors — post to record the payment and print the receipt."
      >
        {(pending ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            Nothing waiting to be posted.
          </p>
        ) : (
          <div className="space-y-2">
            {(pending ?? []).map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    {e.contract?.customer?.display_name ?? "—"} ·{" "}
                    {peso(e.amount)}
                  </div>
                  <div className="truncate text-xs text-muted">
                    #{e.contract?.contract_no} · {e.method}
                    {e.reference_no ? ` · ${e.reference_no}` : ""} ·{" "}
                    {collectorName(e.collector_id)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <PostEntryDialog
                    entryId={e.id}
                    amountLabel={peso(e.amount)}
                    defaultReceiptType={e.contract?.item_type}
                  />
                  <CancelEntryButton entryId={e.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Today's activity per collector */}
      <SectionCard
        title="Today's activity"
        sub="What each collector logged today (Manila)."
      >
        {(dayRollup ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No activity logged yet today.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5 pr-3">Collector</th>
                  <th className="py-1.5 pr-3">Entries</th>
                  <th className="py-1.5 pr-3">Cash</th>
                  <th className="py-1.5 pr-3">Online</th>
                  <th className="py-1.5">Posted</th>
                </tr>
              </thead>
              <tbody>
                {(dayRollup ?? []).map((r) => (
                  <tr key={r.collector_id} className="border-b border-line">
                    <td className="py-1.5 pr-3 font-medium">
                      {r.collector_name ?? collectorName(r.collector_id)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{r.entries}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {peso(r.cash_total)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {peso(r.online_total)}
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {peso(r.posted_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Cash advances */}
      <SectionCard
        title="Cash advances"
        action={<IssueAdvanceButton collectors={collectorList} />}
        sub="Approve requests, then close each advance once receipts reconcile."
      >
        <AdvanceList
          advances={advances ?? []}
          canManage
          collectorName={collectorName}
        />
        {(advances ?? []).length === 0 && (
          <p className="py-4 text-center text-sm text-muted">
            No open or requested advances.
          </p>
        )}
      </SectionCard>

      {/* Assignment worklist */}
      <SectionCard
        title="Assign collectors"
        sub="Overdue and demand accounts — assign a collector and priority."
      >
        <div className="space-y-2">
          {(worklist ?? []).map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-3 py-2"
            >
              <div className="min-w-0">
                <Link
                  href={`/contracts/${c.id}`}
                  className="text-sm font-semibold text-ink hover:underline"
                >
                  {c.display_name}
                </Link>
                <div className="truncate text-xs text-muted">
                  #{c.contract_no} · {peso(c.overdue_amount)} past due ·{" "}
                  {c.collector_id
                    ? `→ ${collectorName(c.collector_id)}${
                        c.collection_priority
                          ? ` (P${c.collection_priority})`
                          : ""
                      }`
                    : "unassigned"}
                </div>
              </div>
              <AssignDialog
                contractId={c.id}
                collectors={collectorList}
                currentCollectorId={c.collector_id}
                currentPriority={c.collection_priority}
                trigger={c.collector_id ? "Reassign" : "Assign"}
              />
            </div>
          ))}
          {(worklist ?? []).length === 0 && (
            <p className="py-4 text-center text-sm text-muted">
              No overdue accounts to assign.
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared row renderers
// ─────────────────────────────────────────────────────────────
type EntryRow = {
  id: string;
  amount: number | string;
  method: string | null;
  reference_no: string | null;
  disposition: string;
  status: string;
  collector_id: string;
  collector_name?: string | null;
  contract?: {
    contract_no?: string;
    item_type?: string | null;
    customer?: { display_name?: string } | null;
  } | null;
};

type AdvanceRow = {
  id: string;
  advance_no: string;
  amount: number | string;
  status: string;
  purpose: string | null;
  collector_id: string | null;
  cash_advance_expenses?: { amount: number | string }[];
};

function EntryList({
  entries,
  showCollector,
}: {
  entries: EntryRow[];
  showCollector: boolean;
}) {
  if (entries.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted">
        Nothing logged today.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div
          key={e.id}
          className={`flex items-center justify-between gap-2 rounded-card px-3 py-2 ${
            e.status === "cancelled" ? "bg-surface opacity-60" : "bg-surface"
          }`}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">
              {e.contract?.customer?.display_name ?? "—"}
              {e.disposition === "collected" ? ` · ${peso(e.amount)}` : ""}
            </div>
            <div className="truncate text-xs text-muted">
              {DISPOSITION_LABELS[e.disposition] ?? e.disposition}
              {e.method ? ` · ${e.method}` : ""} ·{" "}
              <span
                className={
                  e.status === "posted"
                    ? "text-positive"
                    : e.status === "cancelled"
                      ? "text-danger"
                      : "text-muted"
                }
              >
                {e.status}
              </span>
              {showCollector && e.collector_name ? ` · ${e.collector_name}` : ""}
            </div>
          </div>
          {e.status === "pending" && <CancelEntryButton entryId={e.id} />}
        </div>
      ))}
    </div>
  );
}

function AdvanceList({
  advances,
  canManage,
  collectorName,
}: {
  advances: AdvanceRow[];
  canManage: boolean;
  collectorName?: (id: string | null) => string;
}) {
  return (
    <div className="space-y-2">
      {advances.map((a) => {
        const spent = (a.cash_advance_expenses ?? []).reduce(
          (s, x) => s + Number(x.amount),
          0
        );
        const outstanding = Number(a.amount) - spent;
        return (
          <div
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">
                {peso(a.amount)}
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    a.status === "requested"
                      ? "bg-warning-bg text-warning"
                      : "border border-line bg-white text-muted"
                  }`}
                >
                  {a.status.toUpperCase()}
                </span>
              </div>
              <div className="truncate text-xs text-muted">
                #{a.advance_no}
                {a.purpose ? ` · ${a.purpose}` : ""}
                {canManage && collectorName
                  ? ` · ${collectorName(a.collector_id)}`
                  : ""}
                {a.status === "open"
                  ? ` · spent ${peso(spent)} · outstanding ${peso(outstanding)}`
                  : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {a.status === "open" && <AddExpenseButton advanceId={a.id} />}
              {canManage && a.status === "requested" && (
                <ApproveDeclineButtons advanceId={a.id} />
              )}
              {canManage && a.status === "open" && (
                <CloseAdvanceButton advanceId={a.id} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
