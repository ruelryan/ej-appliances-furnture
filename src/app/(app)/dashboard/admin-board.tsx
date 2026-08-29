import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { peso, phTodayISO } from "@/lib/format";
import { StatTile } from "@/components/stat-tile";
import { SectionCard } from "@/components/section-card";
import { EmptyState } from "@/components/empty-state";
import { btnPrimary, btnSecondary } from "@/components/ui";

/**
 * Analyn's board: the day's work queue.
 *
 * Pointedly NOT the owner's tiles. Outstanding balance and total overdue are
 * owner information she cannot act on, and putting them at the top of her
 * screen pushed the things she can act on below the fold. What belongs here is
 * what is waiting for her: money logged in the field that is not a payment
 * yet, deliveries to arrange, leads blocking an agent, and her own tasks.
 */
export async function AdminBoard({ profileId }: { profileId: string }) {
  const supabase = await createClient();
  const today = phTodayISO();

  const [pending, doublePost, deliveries, paidToday, tasks, leads] = await Promise.all([
    supabase
      .from("collection_entries")
      // The customer hangs off the contract, not off the entry — embedding it
      // as customers:contract_id resolves to `contracts` and asks it for a
      // display_name it does not have.
      .select("id, amount, work_date, or_no, contract_id, contracts(contract_no, customers(display_name))")
      .eq("status", "pending")
      .eq("disposition", "collected")
      .order("work_date", { ascending: false })
      .limit(5),
    supabase.from("v_entry_payment_candidates").select("entry_id", { count: "exact", head: true }),
    supabase.from("v_deliveries").select("status, days_awaiting_invoice").in("status", ["pending", "to_order", "ordered"]),
    supabase.from("payments").select("amount").eq("payment_date", today).is("voided_at", null),
    supabase
      .from("tasks")
      .select("id, task_no, title, due_date, priority")
      .in("status", ["open", "in_progress"])
      .or(`assignee_id.eq.${profileId},assignee_role.eq.admin`)
      .order("due_date", { nullsFirst: false })
      .limit(5),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
  ]);

  const pendingRows = pending.data ?? [];
  const pendingTotal = pendingRows.reduce((a, e) => a + Number(e.amount ?? 0), 0);
  const toArrange = (deliveries.data ?? []).filter((d) => d.status !== "ordered").length;
  const staleInvoice = (deliveries.data ?? []).filter((d) => Number(d.days_awaiting_invoice ?? 0) > 3).length;
  const collectedToday = (paidToday.data ?? []).reduce((a, p) => a + Number(p.amount ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Waiting to post"
          value={String(pendingRows.length)}
          sub={pendingRows.length ? peso(pendingTotal) : "Nothing queued"}
          tone={pendingRows.length ? "alert" : "positive"}
          href="/collections"
        />
        <StatTile
          label="Double-post risk"
          value={String(doublePost.count ?? 0)}
          sub="Logged twice — link, don't post"
          tone={(doublePost.count ?? 0) > 0 ? "alert" : "default"}
          href="/collections"
        />
        <StatTile
          label="Deliveries to arrange"
          value={String(toArrange)}
          sub={staleInvoice > 0 ? `${staleInvoice} awaiting invoice 3+ days` : undefined}
          href="/deliveries"
        />
        <StatTile
          label="Posted today"
          value={peso(collectedToday)}
          sub={`${(paidToday.data ?? []).length} payments`}
          tone="positive"
          href="/payments"
        />
      </div>

      <SectionCard
        title="Collections waiting to be posted"
        sub="Logged in the field. Not money in the books until you post or link it."
        action={
          <Link href="/collections" className="text-xs font-medium text-brand hover:underline">
            Open queue
          </Link>
        }
      >
        {pendingRows.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            hint="Collections logged by a collector appear here until they are posted as payments or linked to one already recorded."
          />
        ) : (
          <div className="divide-y divide-line">
            {pendingRows.map((e) => (
              <Link
                key={e.id}
                href={`/contracts/${e.contract_id}`}
                className="-mx-2 flex items-center justify-between gap-3 px-2 py-2.5 hover:bg-surface"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {(e.contracts as unknown as { customers?: { display_name?: string } })
                      ?.customers?.display_name ?? "—"}
                  </span>
                  <span className="block text-xs text-muted">
                    {e.work_date}
                    {e.or_no ? ` · OR ${e.or_no}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {peso(e.amount)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      {(leads.count ?? 0) > 0 && (
        <SectionCard title="Someone is waiting on you">
          <Link href="/leads" className="text-sm text-ink hover:underline">
            <span className="font-semibold">{leads.count}</span> new lead
            {leads.count === 1 ? "" : "s"} to convert or reject — an agent is blocked until you do.
          </Link>
        </SectionCard>
      )}

      <SectionCard
        title="My tasks"
        action={
          <Link href="/tasks" className="text-xs font-medium text-brand hover:underline">
            All tasks
          </Link>
        }
      >
        {(tasks.data ?? []).length === 0 ? (
          <EmptyState title="Nothing assigned" hint="Tasks assigned to you or to the admin team show up here." />
        ) : (
          <div className="divide-y divide-line">
            {(tasks.data ?? []).map((t) => (
              <Link key={t.id} href={`/tasks/${t.id}`} className="-mx-2 flex items-center gap-2 px-2 py-2.5 hover:bg-surface">
                {t.priority === "high" && (
                  <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-micro font-semibold text-danger">
                    HIGH
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.title}</span>
                {t.due_date && <span className="shrink-0 text-xs text-muted">{t.due_date}</span>}
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="flex flex-wrap gap-2">
        <Link href="/payments/new" className={btnPrimary}>
          Record payment
        </Link>
        <Link href="/contracts/new" className={btnSecondary}>
          New contract
        </Link>
      </div>
    </div>
  );
}
