"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createTask } from "./actions";
import { searchContracts } from "@/app/(app)/payments/actions";
import { btnPrimary, input, label } from "@/components/ui";

type Person = { id: string; full_name: string; role: string };
type ContractHit = { id: string; contract_no: string; display_name: string };

export const TEAM_OPTIONS: { value: string; label: string }[] = [
  { value: "collector", label: "Collectors" },
  { value: "admin", label: "Admin" },
  { value: "delivery", label: "Delivery" },
  { value: "sales_agent", label: "Sales agents" },
  { value: "owner", label: "Owner" },
];

export function NewTaskDialog({ people }: { people: Person[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"person" | "team">("person");
  const [assigneeId, setAssigneeId] = useState("");
  const [assigneeRole, setAssigneeRole] = useState("collector");
  const [priority, setPriority] = useState("normal");
  const [contract, setContract] = useState<ContractHit | null>(null);
  const [cq, setCq] = useState("");
  const [hits, setHits] = useState<ContractHit[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (cq.trim().length < 2 || contract) {
      setHits([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setHits((await searchContracts(cq)) as ContractHit[]);
    }, 300);
  }, [cq, contract]);

  function submit(fd: FormData) {
    setError("");
    const title = String(fd.get("title") ?? "").trim();
    if (!title) return setError("Title is required.");
    start(async () => {
      const res = await createTask({
        title,
        body: String(fd.get("body") ?? "").trim(),
        assigneeId: mode === "person" ? assigneeId || null : null,
        assigneeRole: mode === "team" ? assigneeRole : null,
        priority,
        dueDate: String(fd.get("due_date") ?? ""),
        contractId: contract?.id ?? null,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setContract(null);
        setCq("");
        setAssigneeId("");
      }
    });
  }

  const disabled = pending || (mode === "person" && !assigneeId);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
        New task
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <form
            action={submit}
            className="w-full max-w-md space-y-3 rounded-card bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-ink">New task</h3>

            <input name="title" placeholder="What needs doing?" required className={input} />
            <textarea name="body" placeholder="Details (optional)" rows={2} className={input} />

            <div>
              <label className={label}>Assign to</label>
              <div className="mb-2 grid grid-cols-2 gap-2">
                {(["person", "team"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-card border px-3 py-2 text-sm font-semibold capitalize ${
                      mode === m ? "border-brand bg-brand/10 text-brand" : "border-line bg-white text-ink hover:bg-surface"
                    }`}
                  >
                    {m === "person" ? "A person" : "A team"}
                  </button>
                ))}
              </div>
              {mode === "person" ? (
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={input}>
                  <option value="">— select person —</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.role})
                    </option>
                  ))}
                </select>
              ) : (
                <select value={assigneeRole} onChange={(e) => setAssigneeRole(e.target.value)} className={input}>
                  {TEAM_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>Priority</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} className={input}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className={label}>Due (optional)</label>
                <input name="due_date" type="date" className={input} />
              </div>
            </div>

            <div>
              <label className={label}>Link a contract (optional)</label>
              {contract ? (
                <div className="flex items-center justify-between rounded-card bg-surface px-3 py-2 text-sm">
                  <span>
                    #{contract.contract_no} · {contract.display_name}
                  </span>
                  <button type="button" onClick={() => setContract(null)} className="text-xs text-brand hover:underline">
                    Remove
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Search contract no. or name…" className={input} />
                  {hits.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-card border border-line bg-white shadow-lg">
                      {hits.map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => {
                            setContract(h);
                            setCq("");
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-surface"
                        >
                          <span className="font-semibold">#{h.contract_no}</span> · {h.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && <p className="rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-card border border-line py-2 text-sm font-semibold text-ink hover:bg-surface">
                Cancel
              </button>
              <button type="submit" disabled={disabled} className="flex-1 rounded-card bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40">
                {pending ? "Creating…" : "Create task"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
