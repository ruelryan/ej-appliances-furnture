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
    <div className="mt-16 flex justify-between gap-10">
      <div className="w-2/5 text-center">
        <div className="border-t-2 border-ink pt-1 text-xs">{left}</div>
      </div>
      <div className="w-2/5 text-center">
        <div className="border-t-2 border-ink pt-1 text-xs">{right}</div>
      </div>
    </div>
  );
}
