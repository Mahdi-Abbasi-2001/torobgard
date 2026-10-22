import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import { Suspense } from "react";
import Providers from "./providers";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "ترب‌گرد",
  description: "از «کدام را بخرم» تا «جلوی واحد درست»: خرید حضوری در بازارهای تهران با قیمت تأییدشده توسط فروشنده.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F1F5F9" }, { media: "(prefers-color-scheme: dark)", color: "#1A212C" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/* apply a theme picked with the desktop toggle before first paint (no stored choice = follow the system) */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("tg-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}` }} />
      </head>
      <body>
        <Providers>
          <div className="frame">
            <Suspense fallback={null}><TopBar /></Suspense>
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
