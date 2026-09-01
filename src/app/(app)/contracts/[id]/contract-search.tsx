"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { input } from "@/components/ui";
import { peso } from "@/lib/format";

/** A combobox must name the list it controls, and the highlighted option, or
 *  a screen reader announces neither. */
const LIST_ID = "contract-search-results";
const optionId = (i: number) => `contract-search-option-${i}`;

interface Hit {
  id: string;
  contract_no: string;
  display_name: string;
  item_description: string | null;
  payment_status: string;
  remaining_balance: number;
}

/**
 * Jump to another contract, with matches appearing as you type.
 *
 * It fetches a GET route (`/api/contracts/search`) rather than calling a server
 * action, because an action is a POST and middleware refuses every non-GET
 * while "View as" is on. RLS scopes the results, so a collector only ever sees
 * their own worklist here.
 *
 * The surrounding <form> is kept and still works: pressing Enter with nothing
 * highlighted submits to the page, which renders the same search server-side.
 * That is the no-JavaScript path, and it costs one element to keep.
 *
 * Deliberate details, each of which was wrong in an earlier draft:
 *  - 200ms debounce, so a five-letter name is one request rather than five;
 *  - the in-flight request is ABORTED whenever the term changes, which is also
 *    what stops a slow early response landing last and overwriting newer
 *    results — there is no separate stale-response check because the abort
 *    makes one unnecessary;
 *  - the list is only shown while focused and while the term is long enough,
 *    so hits from a previous term are never displayed;
 *  - Escape closes it without clearing what was typed.
 */
export function ContractSearch({
  contractId,
  sort,
  find,
}: {
  contractId: string;
  sort: string;
  find: string;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(find);
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = term.trim();
    // No setState here: too short a term simply has nothing to fetch, and the
    // dropdown is gated on the same length, so stale hits are never shown.
    if (q.length < 2) return;

    const controller = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/contracts/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { results?: Hit[] };
        setHits(json.results ?? []);
        setActive(-1);
      } catch {
        // An abort is the normal case here, not a failure worth showing.
      } finally {
        setBusy(false);
      }
    }, 200);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [term]);

  // Close when the click lands outside, the way a native picker behaves.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = (id: string) => {
    setOpen(false);
    router.push(`/contracts/${id}?nav=${sort}`);
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") return setOpen(false);
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault(); // a highlighted row wins over submitting the form
      go(hits[active].id);
    }
  }

  const show = open && term.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <input
        type="search"
        name="find"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Jump to another contract — name, no., or item…"
        aria-label="Search contracts"
        aria-expanded={show}
        aria-controls={LIST_ID}
        aria-activedescendant={active >= 0 && hits[active] ? optionId(active) : undefined}
        aria-autocomplete="list"
        role="combobox"
        autoComplete="off"
        className={input}
      />

      {show && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-card border border-line bg-white shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted">
              {busy ? "Searching…" : `No contract matches “${term.trim()}”`}
            </p>
          ) : (
            <ul id={LIST_ID} role="listbox" className="max-h-72 overflow-y-auto">
              {hits.map((h, i) => (
                <li key={h.id}>
                  <button
                    type="button"
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h.id)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${
                      i === active ? "bg-surface" : "bg-white"
                    } ${h.id === contractId ? "opacity-50" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {h.display_name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        <span className="font-mono">{h.contract_no}</span>
                        {h.item_description ? ` · ${h.item_description}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm tabular-nums text-ink">
                        {peso(h.remaining_balance)}
                      </span>
                      <span className="block text-micro text-muted">
                        {h.payment_status === "open" ? "Open" : "Closed"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
