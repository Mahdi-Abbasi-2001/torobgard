import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "همراه خرید",
  description: "از «کدام را بخرم» تا «جلوی واحد درست»: خرید حضوری در بازارهای تهران با قیمت تأییدشده توسط فروشنده.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F1F5F9" }, { media: "(prefers-color-scheme: dark)", color: "#1A212C" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <Providers>
          <div className="frame">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
