import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { getSiteThemeVars } from "@/lib/themes";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Saripda Suite",
  description: "Lead-to-sale tracking CRM for insurance agencies",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const themeVars = await getSiteThemeVars();

  return (
    <html
      lang="en"
      className={`${geistMono.variable} h-full antialiased`}
      // Set this high so it cascades to every page — a signed-in agency
      // user's whole site (buttons, primarily) picks up their agency's
      // chosen theme (src/lib/themes.ts) from here. Custom properties
      // aren't in React's CSSProperties type, hence the cast.
      style={themeVars as CSSProperties}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
