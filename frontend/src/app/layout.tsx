import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader, AppHeaderSkeleton } from "@/components/app-header";
import { Providers } from "@/components/providers";
import "./globals.css";

/* App Router has no _document; these global links intentionally load the verified Paycell font families. */
/* eslint-disable @next/next/no-page-custom-font */

export const metadata: Metadata = {
  title: "FraudCell · Risk Command",
  description: "Gerçek zamanlı yapay zekâ destekli dolandırıcılık operasyon platformu",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.cdnfonts.com" />
        <link rel="stylesheet" href="https://fonts.cdnfonts.com/css/campton" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" />
      </head>
      <body>
        <Providers>
          <Suspense fallback={<AppHeaderSkeleton />}><AppHeader /></Suspense>
          <main className="mx-auto max-w-[1500px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
