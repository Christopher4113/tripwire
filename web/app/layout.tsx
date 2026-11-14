import type { Metadata } from "next";
import { Funnel_Display, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Same pairing Inkbox ships (Funnel Display headings, Geist body) so the demo reads as native to them.
const funnel = Funnel_Display({ variable: "--font-funnel", subsets: ["latin"], weight: ["500", "600", "700"] });
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
// Mono only for literal machine text: payloads, prompts, phone numbers.
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "tripwire · signed-webhook injection eval for Inkbox agents",
  description: "GitHub signs the delivery. Strangers write the text. tripwire measures what an Inkbox agent does with it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${funnel.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
