import { COMPANY } from "@/lib/messages";

export function Letterhead() {
  return (
    <div className="mb-4 border-b-2 border-sky-900 pb-2 text-center">
      <div className="text-xl font-bold text-sky-900">{COMPANY.name}</div>
      <div className="text-xs text-slate-600">{COMPANY.address}</div>
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
        <div className="border-t-2 border-slate-800 pt-1 text-xs">{left}</div>
      </div>
      <div className="w-2/5 text-center">
        <div className="border-t-2 border-slate-800 pt-1 text-xs">{right}</div>
      </div>
    </div>
  );
}
