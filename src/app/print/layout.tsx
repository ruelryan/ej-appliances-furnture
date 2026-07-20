export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div id="print-area" className="mx-auto max-w-[210mm] bg-white p-8 text-black print:p-0">
      {children}
    </div>
  );
}
