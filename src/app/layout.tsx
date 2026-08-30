import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "E & J Appliances Furniture",
  description: "Contracts, payments, collections, and analytics for E & J",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Records how long pages actually take on the staff's own phones, on
            the screens they actually use. Everything measured so far has been
            me timing two public endpoints from a laptop — neither of which
            touches getProfile, and both of which swung between 0.20s and 0.94s
            on identical requests. That variance is cold starts, and it is
            wider than the database latency I was trying to see.

            This is what decides whether the remaining slowness is worth
            migrating a live financial database for. It samples real page loads
            and sends timing only — no form contents, no customer data. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
