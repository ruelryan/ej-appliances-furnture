import { COMPANY } from "@/lib/messages";
import { LogoMark } from "@/components/logo";

export function Letterhead() {
  return (
    <div className="mb-4 border-b-2 border-ink pb-2 text-center">
      <span className="mx-auto mb-1 block w-fit text-ink">
        <LogoMark className="h-9 w-9" />
      </span>
      <div className="text-xl font-semibold text-ink">{COMPANY.name}</div>
      <div className="text-xs text-ink">{COMPANY.address}</div>
    </div>
  );
}

export function SignatureBlocks({
  left = "Signature Over Printed Name",
  right = "Date Received",
}: {
  left?: string;
  right?: string;
}) {
  return (
    <div className="print-keep mt-10 flex justify-between gap-10">
      <div className="w-2/5 text-center">
        <div className="border-t-2 border-ink pt-1 text-xs">{left}</div>
      </div>
      <div className="w-2/5 text-center">
        <div className="border-t-2 border-ink pt-1 text-xs">{right}</div>
      </div>
    </div>
  );
}

/**
 * The owner's sign-off: their signature over their printed name. One block, on
 * the left — a demand letter is served BY us, so there is nothing for the
 * customer to sign on it.
 *
 * The signature image comes from OWNER_SIGNATURE_DATA_URI (a data: URI) and is
 * deliberately NOT a file in the repo: this repo is public on GitHub, git keeps
 * history forever, and anything under public/ is served to the world with no
 * auth. A real signature authenticates contracts, demand letters and
 * amendments, so publishing one invites forgery of exactly those documents.
 * Read here in a server component, it only ever reaches the rendered HTML of an
 * owner/admin-gated page.
 *
 * With the variable unset (any local checkout, and every Preview deploy, since
 * env vars here are Production-scoped) this falls back to a ruled line to sign
 * by hand — the letter stays printable, it just is not pre-signed.
 */
export function OwnerSignature({ closing }: { closing?: string }) {
  const signature = process.env.OWNER_SIGNATURE_DATA_URI;

  return (
    // `closing` lives in here rather than at the end of the letter body so the
    // valediction cannot be stranded at the foot of page 1 with the signature
    // over the page break. print-keep holds the whole block together.
    <div className="print-keep mt-10 w-3/5">
      {closing && <div className="mb-6">{closing}</div>}
      {signature ? (
        // A data: URI must not go through the image optimizer — next/image
        // would try to fetch and re-encode it, and it is already 7KB.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signature}
          alt=""
          className="mb-1 ml-1 h-16 w-auto object-contain object-bottom"
        />
      ) : (
        <div className="h-16" />
      )}
      <div className="border-t-2 border-ink pt-1">
        <div className="text-sm font-semibold">{COMPANY.owner}</div>
        <div className="text-xs">{COMPANY.ownerTitle}</div>
        <div className="text-xs">{COMPANY.name}</div>
      </div>
    </div>
  );
}
