"use client";

import type { ReactNode } from "react";
import { CatalogProvider } from "@/context/CatalogContext";
import Header from "./Header";
import Footer from "./Footer";
import CartDrawer from "./CartDrawer";
import FloatingButtons from "./FloatingButtons";

/**
 * Shared chrome for every customer-facing page: header, footer, cart drawer
 * and floating actions — plus the CatalogProvider that keeps header search,
 * tag chips and result grids in sync.
 */
export default function StorefrontShell({ children }: { children: ReactNode }) {
  return (
    <CatalogProvider>
      <Header />
      <main className="flex-1 w-full">{children}</main>
      <Footer />
      <CartDrawer />
      <FloatingButtons />
    </CatalogProvider>
  );
}
