import Link from "next/link";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { RestorePaymentButton, VoidPaymentButton } from "./void-button";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const supabase = await createClient();
  const profile = await getProfile();
  const isOwner = profile?.role === "owner";

  let query = supabase
    .from("payments")
    .select(
      "*, contracts(id, contract_no, customers(display_name))"
    )
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (q.trim()) {
    query = query.or(`payment_no.ilike.%${q.trim()}%,receipt_no.ilike.%${q.trim()}%`);
  }

  const { data: payments } = await query;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy">
          Payments
        </h1>
        <Link
          href="/payments/new"
          className="rounded-card bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          + Record
        </Link>
      </div>

      <form className="flex gap-2" action="/payments" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search PAY# or OR#…"
          className="w-full rounded-card border border-surface px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Search
        </button>
      </form>

      <div className="space-y-2">
        {(payments ?? []).map((p) => {
          const contract = p.contracts as unknown as {
            id: string;
            contract_no: string;
            customers: { display_name: string };
          } | null;
          return (
            <div
              key={p.id}
              className={`rounded-card border border-surface bg-white p-4 ${
                p.voided_at ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-navy">
                    {contract?.customers?.display_name ?? "—"}
                    {p.voided_at && (
                      <span className="ml-2 rounded bg-danger-bg px-1.5 py-0.5 text-[10px] font-bold text-danger">
                        VOIDED
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    <span className="font-mono">{p.payment_no}</span> ·{" "}
                    {fmtDateShort(p.payment_date)}
                    {p.receipt_no ? ` · OR# ${p.receipt_no}` : ""}
                    {contract && (
                      <>
                        {" · "}
                        <Link
                          href={`/contracts/${contract.id}`}
                          className="text-brand hover:underline"
                        >
                          #{contract.contract_no}
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right font-bold text-navy">
                    {peso(p.amount)}
                  </div>
                  {isOwner &&
                    (p.voided_at ? (
                      <RestorePaymentButton
                        paymentId={p.id}
                        paymentNo={p.payment_no}
                      />
                    ) : (
                      <VoidPaymentButton
                        paymentId={p.id}
                        paymentNo={p.payment_no}
                        customerName={contract?.customers?.display_name ?? "—"}
                        amount={Number(p.amount)}
                        paymentDate={p.payment_date}
                      />
                    ))}
                </div>
              </div>
            </div>
          );
        })}
        {payments?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            No payments found.
          </p>
        )}
      </div>
    </div>
  );
}
