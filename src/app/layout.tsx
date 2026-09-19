import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import { WalletProvider } from "@/context/WalletContext";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { StockProvider } from "@/context/StockContext";
import { ThemeProvider, themeInitScript } from "@/context/ThemeContext";
import { BRAND } from "@/lib/config";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-stack",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.fullName} — Accounts, Verifications, VPNs & Proxies`,
    template: `%s | ${BRAND.fullName}`,
  },
  description:
    "Buy verified social media accounts, SMS verification numbers, premium VPN subscriptions and residential proxies. Instant delivery, 24-hour replacement guarantee.",
  keywords: [
    "buy facebook accounts",
    "tiktok accounts",
    "instagram accounts",
    "sms verification",
    "virtual numbers",
    "vpn accounts",
    "residential proxies",
  ],
  openGraph: {
    title: `${BRAND.fullName} — Digital Accounts Marketplace`,
    description: BRAND.tagline,
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Runs before first paint so the persisted theme is applied without a
          flash of the wrong colour scheme. Must stay inline and synchronous.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        <ThemeProvider>
          <CurrencyProvider>
            <AuthProvider>
              <WalletProvider>
                <StockProvider>
                  <CartProvider>{children}</CartProvider>
                </StockProvider>
              </WalletProvider>
            </AuthProvider>
          </CurrencyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
