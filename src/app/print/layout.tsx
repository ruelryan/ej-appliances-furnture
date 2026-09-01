export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // 210mm is A4 width and the padding is the @page margin from globals.css,
    // so what you see on screen is the text block you get on paper. Both are
    // dropped when printing (`print:` + the #print-area rule) because there
    // the sheet itself supplies the margin.
    <div
      id="print-area"
      className="mx-auto max-w-[210mm] bg-white px-[14mm] py-[14mm] text-black print:max-w-none print:p-0"
    >
      {children}
    </div>
  );
}
