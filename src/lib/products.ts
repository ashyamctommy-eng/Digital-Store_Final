import type { SortOption } from "./categories";

/**
 * A digital stock item. Field names follow the marketplace data contract
 * (snake_case for the fields that were specified), with a few additions
 * the storefront needs.
 */
export interface Product {
  id: string;
  slug: string;
  name: string;
  /** Category id — see src/lib/categories.ts */
  category: string;
  country_flags: string;
  /** Base price in USD — the single source of truth. KES is derived. */
  price_usd: number;
  /** Optional strike-through price, also USD. */
  original_price_usd?: number;
  image: string;
  stock: number;
  description: string;
  /** Spec bullets shown on the detail page, e.g. "Email included". */
  specs: string[];
  guide_url: string;
  badge?: "Best Seller" | "New Arrival" | "Hot" | "Restocked";
  /** Drives the "featured" rail at the top of the storefront. */
  featured?: boolean;
  /** Roughly how fast the item is handed over after payment. */
  delivery?: string;
  /**
   * How this product is fulfilled.
   *  - "credentials" (default): a pre-bought account line from inventory.
   *  - "sms": a phone number + inbox, served from pre-bought stock first and
   *    from the on-demand provider only when static stock runs out.
   *  - "proxy": an IP:PORT list stocked by hand, claimed in whole units.
   */
  delivery_kind?: "credentials" | "sms" | "proxy";
  /** Required when delivery_kind is "sms". Drives the on-demand provider. */
  sms?: {
    /** Provider service code: wa, tg, fb, go, lf … */
    service_id: string;
    /** Provider country id (see the provider's /countries). */
    country_id: string;
    /** 1 = all countries, 2 = USA only, 3 = requires provider_id. */
    server_id?: string;
    /** Display label for the service being verified. */
    label: string;
  };
  /** Required when delivery_kind is "proxy". */
  proxy?: {
    /** How many addresses one unit of this product is worth. */
    per_unit: number;
    /** Display label for the network being supplied. */
    label: string;
  };
}

export const products: Product[] = [
  /* ------------------------------- Facebook ------------------------------ */
  {
    id: "fb-usa-01",
    slug: "usa-facebook-account-aged-verified",
    name: "USA Facebook Account (Aged / Verified)",
    category: "facebook",
    country_flags: "🇺🇸",
    price_usd: 51.00,
    original_price_usd: 61.50,
    image: "/assets/images/facebook-3d.svg",
    stock: 150,
    description:
      "2020-2023 Aged USA Facebook Account | Cookies included | Email verified",
    specs: [
      "Aged 2020-2023, real farming history",
      "Email address included and verified",
      "Browser cookies bundled for instant login",
      "Clean device fingerprint — no prior bans",
      "2FA-ready, US residential IP created",
    ],
    guide_url: "https://drive.google.com/",
    badge: "Best Seller",
    featured: true,
    delivery: "Instant",
  },
  {
    id: "fb-uk-02",
    slug: "uk-facebook-account-aged",
    name: "UK Facebook Account (Aged / Verified)",
    category: "facebook",
    country_flags: "🇬🇧",
    price_usd: 48.50,
    image: "/assets/images/facebook-3d.svg",
    stock: 96,
    description: "2019-2022 Aged UK Facebook Account | Email verified | Cookies included",
    specs: [
      "Aged 2019-2022 with UK profile history",
      "Verified email login included",
      "Cookies + recovery details provided",
      "Suited to marketplace and ads accounts",
    ],
    guide_url: "https://drive.google.com/",
    delivery: "Instant",
  },
  {
    id: "fb-ng-03",
    slug: "nigeria-facebook-account-fresh",
    name: "Nigeria Facebook Account (Fresh)",
    category: "facebook",
    country_flags: "🇳🇬",
    price_usd: 29.00,
    image: "/assets/images/facebook-3d.svg",
    stock: 240,
    description: "Fresh Nigerian Facebook accounts | Email included | Ready for warm-up",
    specs: [
      "Created on clean NG residential IPs",
      "Email included with full access",
      "Ideal for bulk / multi-accounting",
      "Replacement guarantee within 24 hours",
    ],
    guide_url: "",
    badge: "New Arrival",
    delivery: "Instant",
  },
  {
    id: "fb-de-04",
    slug: "germany-facebook-account-aged",
    name: "Germany Facebook Account (Aged)",
    category: "facebook",
    country_flags: "🇩🇪",
    price_usd: 50.00,
    image: "/assets/images/facebook-3d.svg",
    stock: 7,
    description: "Aged German Facebook accounts with verified email and cookies",
    specs: [
      "EU profile history since 2020",
      "Verified email + cookies",
      "Strong for EU ad accounts",
    ],
    guide_url: "https://drive.google.com/",
    delivery: "Instant",
  },

  /* ------------------------------ Instagram ----------------------------- */
  {
    id: "ig-5k-01",
    slug: "instagram-5k-followers-account",
    name: "Instagram 5K+ Followers Account",
    category: "instagram",
    country_flags: "🇺🇸🇬🇧",
    price_usd: 68.50,
    original_price_usd: 92.50,
    image: "/assets/images/instagram-3d.svg",
    stock: 42,
    description: "Instagram Accounts | Verified by email | Email included | 5,000+ real followers",
    specs: [
      "5,000+ organic-looking followers",
      "Email included and verified",
      "Reels monetisation eligible",
      "No prior strikes or restrictions",
    ],
    guide_url: "https://drive.google.com/",
    badge: "Hot",
    featured: true,
    delivery: "Instant",
  },
  {
    id: "ig-1k-02",
    slug: "instagram-1k-followers-account",
    name: "Instagram 1K+ Followers Account",
    category: "instagram",
    country_flags: "🇺🇸🇨🇦",
    price_usd: 40.00,
    image: "/assets/images/instagram-3d.svg",
    stock: 130,
    description: "Instagram Accounts | Verified by email | Email included | 1,000+ followers",
    specs: [
      "1,000+ followers, niche-mixed",
      "Email included",
      "Ready for immediate posting",
    ],
    guide_url: "",
    badge: "Best Seller",
    delivery: "Instant",
  },
  {
    id: "ig-aged-03",
    slug: "instagram-aged-empty-account",
    name: "Instagram Aged Empty Account",
    category: "instagram",
    country_flags: "🌍",
    price_usd: 22.50,
    image: "/assets/images/instagram-3d.svg",
    stock: 310,
    description: "2018-2021 aged Instagram accounts with no posts — perfect clean slate",
    specs: [
      "Aged 2018-2021, zero posts",
      "Email + password supplied",
      "Best value for bulk creators",
    ],
    guide_url: "",
    delivery: "Instant",
  },

  /* -------------------------------- TikTok ------------------------------ */
  {
    id: "tiktok-600",
    slug: "tiktok-600-followers-account",
    name: "TikTok 600+ Followers Account",
    category: "tiktok",
    country_flags: "🇺🇸🇬🇧🇨🇦🇧🇷🔥",
    price_usd: 52.00,
    image: "/assets/images/tiktok-3d.svg",
    stock: 80,
    description: "TikTok Accounts | Verified by email | Email included | 500-600+ followers",
    specs: [
      "500-600+ followers",
      "Verified by email, email included",
      "US / UK / CA / BR regions available",
      "Eligible for Creator Rewards in supported regions",
    ],
    guide_url: "https://drive.google.com/",
    badge: "Best Seller",
    featured: true,
    delivery: "Instant",
  },
  {
    id: "tiktok-1k",
    slug: "tiktok-1000-followers-account",
    name: "TikTok 1,000+ Followers Account",
    category: "tiktok",
    country_flags: "🇺🇸🇬🇧",
    price_usd: 81.00,
    original_price_usd: 100.00,
    image: "/assets/images/tiktok-3d.svg",
    stock: 26,
    description: "TikTok Accounts | Verified by email | 1,000+ followers | Live-ready",
    specs: [
      "1,000+ followers, high completion rate",
      "Live streaming unlocked",
      "Verified email included",
    ],
    guide_url: "https://drive.google.com/",
    badge: "Hot",
    delivery: "Instant",
  },
  {
    id: "tiktok-mon-01",
    slug: "tiktok-monetised-account",
    name: "TikTok Monetised Account (Creator Rewards)",
    category: "tiktok",
    country_flags: "🇺🇸🇬🇧🇩🇪",
    price_usd: 188.50,
    image: "/assets/images/tiktok-3d.svg",
    stock: 6,
    description: "TikTok accounts already approved for the Creator Rewards Programme",
    specs: [
      "Creator Rewards Programme approved",
      "10,000+ followers, 100k+ views",
      "Region set to US / UK / DE",
      "Full email + 2FA handover",
    ],
    guide_url: "https://drive.google.com/",
    delivery: "Within 1 hour",
  },

  /* --------------------------------- SMS -------------------------------- */
  /*
   * Every product here uses delivery_kind "sms": fulfilment tries pre-bought
   * static stock first (PHONE | INBOX_URL_OR_NOTES) and falls back to the
   * on-demand provider when that runs out. If neither is available the
   * storefront shows Out of Stock and checkout is disabled.
   */
  {
    id: "sms-whatsapp",
    slug: "whatsapp-sms-verification-number",
    name: "WhatsApp SMS Verification Number",
    category: "sms",
    country_flags: "🇺🇸🇬🇧🇨🇦",
    price_usd: 4.50,
    original_price_usd: 7.50,
    image: "/assets/images/sms-3d.svg",
    // Availability comes from pre-bought stock or the provider,
    // never from a hard-coded number.
    stock: 0,
    description:
      "A private number that receives the WhatsApp verification code for you | Live inbox included",
    specs: [
      "Fresh number reserved for your order only",
      "Watch the code arrive in the live inbox",
      "Works for new WhatsApp registrations",
      "Never reused once it has been sold",
    ],
    guide_url: "",
    badge: "Best Seller",
    featured: true,
    delivery: "Instant",
    delivery_kind: "sms",
    sms: { service_id: "wa", country_id: "2", server_id: "2", label: "WhatsApp" },
  },
  {
    id: "sms-telegram",
    slug: "telegram-sms-verification-number",
    name: "Telegram SMS Verification Number",
    category: "sms",
    country_flags: "🇺🇸🇬🇧",
    price_usd: 4.20,
    image: "/assets/images/sms-3d.svg",
    // Availability comes from pre-bought stock or the provider,
    // never from a hard-coded number.
    stock: 0,
    description:
      "Receive the Telegram login code on a dedicated number | Live inbox included",
    specs: [
      "Dedicated number for your order",
      "Live inbox with the code as it lands",
      "Works with new Telegram accounts",
      "Replacement if no code arrives",
    ],
    guide_url: "",
    delivery: "Instant",
    delivery_kind: "sms",
    sms: { service_id: "tg", country_id: "2", server_id: "2", label: "Telegram" },
  },
  {
    id: "sms-facebook",
    slug: "facebook-sms-verification-number",
    name: "Facebook SMS Verification Number",
    category: "sms",
    country_flags: "🇺🇸🇬🇧🇨🇦",
    price_usd: 4.20,
    image: "/assets/images/sms-3d.svg",
    // Availability comes from pre-bought stock or the provider,
    // never from a hard-coded number.
    stock: 0,
    description:
      "Verify or recover a Facebook account with a dedicated SMS number",
    specs: [
      "Dedicated number for your order",
      "Live inbox with the code as it lands",
      "Suited to sign-up and recovery flows",
      "Replacement if no code arrives",
    ],
    guide_url: "",
    badge: "New Arrival",
    delivery: "Instant",
    delivery_kind: "sms",
    sms: { service_id: "fb", country_id: "2", server_id: "2", label: "Facebook" },
  },
  {
    id: "sms-google",
    slug: "google-youtube-sms-verification-number",
    name: "Google / YouTube SMS Verification Number",
    category: "sms",
    country_flags: "🇺🇸",
    price_usd: 3.50,
    image: "/assets/images/sms-3d.svg",
    // Availability comes from pre-bought stock or the provider,
    // never from a hard-coded number.
    stock: 0,
    description:
      "Verify a Google, Gmail or YouTube account with a dedicated number",
    specs: [
      "Dedicated number for your order",
      "Live inbox with the code as it lands",
      "Gmail, YouTube and Google account flows",
      "Replacement if no code arrives",
    ],
    guide_url: "",
    delivery: "Instant",
    delivery_kind: "sms",
    sms: { service_id: "go", country_id: "2", server_id: "2", label: "Google" },
  },
  {
    id: "sms-tiktok",
    slug: "tiktok-sms-verification-number",
    name: "TikTok SMS Verification Number",
    category: "sms",
    country_flags: "🇺🇸🇬🇧",
    price_usd: 3.50,
    image: "/assets/images/sms-3d.svg",
    // Availability comes from pre-bought stock or the provider,
    // never from a hard-coded number.
    stock: 0,
    description:
      "Verify a TikTok account with a dedicated number and live inbox",
    specs: [
      "Dedicated number for your order",
      "Live inbox with the code as it lands",
      "Works for sign-up and login checks",
      "Replacement if no code arrives",
    ],
    guide_url: "",
    delivery: "Instant",
    delivery_kind: "sms",
    sms: { service_id: "lf", country_id: "2", server_id: "2", label: "TikTok" },
  },

  /* --------------------------------- VPN -------------------------------- */
  {
    id: "vpn-nord-1y",
    slug: "nordvpn-1-year-premium",
    name: "NordVPN 1 Year Premium Account",
    category: "vpn",
    country_flags: "🛡️",
    price_usd: 34.50,
    original_price_usd: 75.50,
    image: "/assets/images/nordvpn-logo.svg",
    stock: 45,
    description: "1 Year Premium Subscription | Auto-renewal active | High speed",
    specs: [
      "12 months of full Premium access",
      "5,400+ servers across 60 countries",
      "Threat Protection + ad blocking",
      "Auto-renewal already active",
      "Replacement if the login ever fails",
    ],
    guide_url: "https://drive.google.com/",
    badge: "Best Seller",
    featured: true,
    delivery: "Instant",
  },
  {
    id: "vpn-surf-6m",
    slug: "surfshark-6-months",
    name: "Surfshark VPN 6 Months",
    category: "vpn",
    country_flags: "🛡️",
    price_usd: 20.00,
    image: "/assets/images/vpn-lock-3d.svg",
    stock: 70,
    description: "6 Months unlimited devices | No-log policy | Clean IPs",
    specs: [
      "6 months access",
      "Unlimited simultaneous devices",
      "Works on iOS, Android, Windows, macOS",
    ],
    guide_url: "",
    delivery: "Instant",
  },
  {
    id: "vpn-express-1y",
    slug: "expressvpn-1-year",
    name: "ExpressVPN 1 Year Subscription",
    category: "vpn",
    country_flags: "🛡️",
    price_usd: 47.50,
    image: "/assets/images/vpn-lock-3d.svg",
    stock: 18,
    description: "Premium ExpressVPN 12-month subscription with Lightway protocol",
    specs: [
      "12 months premium access",
      "Lightway protocol, streaming-optimised",
      "24/7 live chat support included",
    ],
    guide_url: "https://drive.google.com/",
    badge: "New Arrival",
    delivery: "Instant",
  },

  /* -------------------------------- Proxy ------------------------------- */
  {
    id: "proxy-9p-10",
    slug: "9proxy-static-residential-10ips",
    name: "10 IPs 9Proxy Static Residentials",
    category: "proxy",
    country_flags: "🌐",
    price_usd: 46.00,
    image: "/assets/images/proxy-logo.svg",
    // Availability comes from IP:PORT stock the admin uploads, never from a
    // hard-coded number.
    stock: 0,
    description:
      "Clean static residential proxies for multi-accounting and scrapers",
    specs: [
      "10 static residential IPs",
      "Unlimited bandwidth per IP",
      "HTTP(S) + SOCKS5 support",
      "US/EU location selection",
      "Instant credential delivery",
    ],
    guide_url: "",
    badge: "Best Seller",
    featured: true,
    delivery: "Instant",
    delivery_kind: "proxy",
    proxy: { per_unit: 10, label: "Static IPs" },
  },
  {
    /*
     * Deliberately NOT delivery_kind "proxy": this sells 5GB of rotating
     * bandwidth with a gateway credential, not a list of addresses. The proxy
     * provider hands back IP:PORT pairs, so auto-fulfilling this would deliver
     * the wrong thing. Stock it by hand.
     */
    id: "proxy-rot-01",
    slug: "rotating-residential-proxies-5gb",
    name: "Rotating Residential Proxies — 5GB",
    category: "proxy",
    country_flags: "🌐",
    price_usd: 26.00,
    image: "/assets/images/proxy-logo.svg",
    stock: 400,
    description: "5GB rotating residential traffic with automatic IP rotation",
    specs: [
      "5GB bandwidth included",
      "Millions of rotating residential IPs",
      "Sticky sessions up to 30 minutes",
      "City-level targeting",
    ],
    guide_url: "",
    delivery: "Instant",
  },
  {
    id: "proxy-mobile-02",
    slug: "mobile-4g-proxies-5ips",
    name: "Mobile 4G Proxies — 5 IPs",
    category: "proxy",
    country_flags: "🇺🇸🌐",
    price_usd: 55.50,
    image: "/assets/images/proxy-logo.svg",
    stock: 0,
    description: "Premium 4G mobile proxies on US carrier networks",
    specs: [
      "5 dedicated 4G mobile IPs",
      "Carrier-grade NAT, highest trust score",
      "Perfect for social media automation",
    ],
    guide_url: "https://drive.google.com/",
    badge: "Hot",
    delivery: "Within 1 hour",
    delivery_kind: "proxy",
    proxy: { per_unit: 5, label: "Mobile IPs" },
  },
  {
    id: "proxy-dc-03",
    slug: "datacenter-proxies-25ips",
    name: "Datacenter Proxies — 25 IPs",
    category: "proxy",
    country_flags: "🌐",
    price_usd: 17.00,
    image: "/assets/images/proxy-logo.svg",
    stock: 0,
    description: "Fast datacenter proxies for scraping and bulk requests",
    specs: [
      "25 datacenter IPs",
      "Gigabit throughput",
      "API-based rotation",
    ],
    guide_url: "",
    delivery: "Instant",
    delivery_kind: "proxy",
    proxy: { per_unit: 25, label: "Datacenter IPs" },
  },
];

/* ---------------------------------------------------------------------- */
/* Lookups & filtering                                                     */
/* ---------------------------------------------------------------------- */

export function getProductBySlug(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export function getProductById(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function getProductsByCategory(categoryId: string): Product[] {
  return products.filter((p) => p.category === categoryId);
}

export const featuredProducts = products.filter((p) => p.featured);

/** True when the query matches name, description, category or a spec bullet. */
export function matchesQuery(product: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    product.name,
    product.description,
    product.category,
    product.country_flags,
    ...product.specs,
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

export interface BrowseFilters {
  query?: string;
  category?: string | null;
  tag?: string | null;
  sort?: SortOption;
}

/** Maps a popular-tag chip to the categories it should surface. */
const TAG_TO_CATEGORIES: Record<string, string[]> = {
  vpn: ["vpn"],
  proxy: ["proxy"],
  facebook: ["facebook"],
  instagram: ["instagram"],
  "sms numbers": ["sms"],
  sms: ["sms"],
  tiktok: ["tiktok"],
};

export function browseProducts(filters: BrowseFilters = {}): Product[] {
  const { query = "", category = null, tag = null, sort = "popular" } = filters;
  let list = products.filter((p) => matchesQuery(p, query));

  if (category) list = list.filter((p) => p.category === category);

  if (tag) {
    const mapped = TAG_TO_CATEGORIES[tag.toLowerCase()];
    if (mapped) list = list.filter((p) => mapped.includes(p.category));
  }

  switch (sort) {
    case "price-asc":
      list = [...list].sort((a, b) => a.price_usd - b.price_usd);
      break;
    case "price-desc":
      list = [...list].sort((a, b) => b.price_usd - a.price_usd);
      break;
    case "new":
      list = [...list].sort(
        (a, b) => Number(b.badge === "New Arrival") - Number(a.badge === "New Arrival")
      );
      break;
    default:
      // "Popular": featured first, then by how much stock has moved.
      list = [...list].sort(
        (a, b) => Number(b.featured ?? false) - Number(a.featured ?? false)
      );
  }

  return list;
}

/** Price bounds across the whole catalog, used by the price range filter. */
export const priceBounds = {
  min: Math.min(...products.map((p) => p.price_usd)),
  max: Math.max(...products.map((p) => p.price_usd)),
};

/* ---------------------------------------------------------------------- */
/* Delivery kinds                                                          */
/* ---------------------------------------------------------------------- */

/** True when a product is fulfilled as a phone number + inbox. */
export function isSmsProduct(product: Product): boolean {
  return product.delivery_kind === "sms";
}

export interface SmsSpec {
  service_id: string;
  country_id: string;
  server_id: string;
  label: string;
}

/** The on-demand provider spec for an SMS product, if it has one. */
export function getSmsSpec(productId: string): SmsSpec | null {
  const product = products.find((p) => p.id === productId);
  if (!product || !product.sms) return null;
  return {
    service_id: product.sms.service_id,
    country_id: product.sms.country_id,
    server_id: product.sms.server_id ?? "1",
    label: product.sms.label,
  };
}

/** Every SMS product, used to keep the server-side catalog map in step. */
export const smsProducts: Product[] = products.filter(isSmsProduct);

/** True when a product is fulfilled as an IP:PORT list. */
export function isProxyProduct(product: Product): boolean {
  return product.delivery_kind === "proxy";
}

export interface ProxySpec {
  per_unit: number;
  label: string;
}

/** The stock spec for a proxy product, if it has one. */
export function getProxySpec(productId: string): ProxySpec | null {
  const product = products.find((p) => p.id === productId);
  if (!product || !product.proxy) return null;
  return {
    per_unit: Math.max(1, product.proxy.per_unit),
    label: product.proxy.label,
  };
}

/** Every proxy product, used to keep the server-side catalog map in step. */
export const proxyProducts: Product[] = products.filter(isProxyProduct);
