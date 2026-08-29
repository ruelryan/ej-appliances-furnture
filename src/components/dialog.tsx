"use client";

import { useEffect, useRef } from "react";

/**
 * One modal for the whole app.
 *
 * There were 16 hand-rolled `fixed inset-0 z-50` backdrops. None had
 * role="dialog", a focus trap, Escape handling or a body-scroll lock, and only
 * one could scroll its own content. That last omission was a real field
 * blocker: the log-collection panel is vertically centred and taller than a
 * phone once the soft keyboard is up, so its submit button sat off-screen with
 * no way to reach it.
 *
 * This uses the native <dialog> element and showModal(), which gives the focus
 * trap, Escape, top-layer stacking and ::backdrop for free — every one of the
 * things the hand-rolled versions lacked, with less code than they used. The
 * scroll lock lives in globals.css as `html:has(dialog[open])`.
 *
 * Layout is a bottom sheet on a phone and a centred panel from `sm` up: a
 * thumb reaches the bottom of the screen, not the middle.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // showModal() throws if already open, and close() on a closed dialog is a
    // no-op — guard both so a re-render never desyncs the element.
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      // `close` fires for Escape and for form method="dialog" alike, so the
      // parent's state follows the element however it was dismissed.
      onClose={onClose}
      onClick={(e) => {
        // The backdrop is part of the <dialog> box, so a click landing on the
        // element itself (not a child) is a backdrop click.
        if (e.target === ref.current) onClose();
      }}
      className="w-full max-w-sm rounded-card bg-white p-0 text-ink backdrop:bg-black/50 open:flex open:flex-col max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none"
      style={{ maxHeight: "85dvh" }}
    >
      <div className="shrink-0 border-b border-line px-5 pb-3 pt-4">
        <h3 id="dialog-title" className="text-base font-semibold text-ink">
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
      </div>

      {/* The scrollable middle. This is the part the hand-rolled modals were
          missing, and the reason the field dialog could not be submitted. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

      {footer && (
        <div className="shrink-0 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      )}
    </dialog>
  );
}
