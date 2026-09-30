import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { APPLY_THEME_SCRIPT } from "@/components/ui/theme-script";
import { ThemeProvider } from "@/components/ui/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "FastAuth — License & Authentication Platform",
    template: "%s · FastAuth",
  },
  description:
    "Multi-tenant authentication, licensing and device management for your applications.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // `suppressHydrationWarning` is required, not cosmetic: the script below
      // sets `data-theme` on this element before React hydrates, so the server
      // and client markup genuinely differ and React would otherwise warn.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          Applies the saved theme before the first paint. It must be here, in the
          document head, and inline: deferring it to an effect or an external
          file would show the wrong theme for at least one frame.
        */}
        <script dangerouslySetInnerHTML={{ __html: APPLY_THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
