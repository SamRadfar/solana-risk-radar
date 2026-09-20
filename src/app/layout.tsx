import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Solana Risk Radar — deterministic token risk analysis",
  description:
    "Paste any Solana token address and understand its major risk signals within seconds. Deterministic, explainable, evidence-backed risk analysis — not financial advice.",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "Solana Risk Radar",
    description:
      "Deterministic, evidence-backed risk analysis for any Solana token. 14 signals, 5 categories, every number auditable.",
    type: "website",
  },
};

/** Matches the canvas so mobile browser chrome blends into the page. */
export const viewport: Viewport = {
  themeColor: "#05060a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
