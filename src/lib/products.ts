import { COMMERCE } from "./config";
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
  price: number;
  original_price?: number;
  currency: string;
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
}

const KES = COMMERCE.currency;

export const products: Product[] = [
  /* ------------------------------- Facebook ------------------------------ */
  {
    id: "fb-usa-01",
    slug: "usa-facebook-account-aged-verified",
    name: "USA Facebook Account (Aged / Verified)",
    category: "facebook",
    country_flags: "🇺🇸",
    price: 6600,
    original_price: 8000,
    currency: KES,
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
    price: 6300,
    currency: KES,
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
    price: 3800,
    currency: KES,
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
    price: 6500,
    currency: KES,
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
    price: 8900,
    original_price: 12000,
    currency: KES,
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
    price: 5200,
    currency: KES,
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
    price: 2900,
    currency: KES,
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
    price: 6750,
    currency: KES,
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
    price: 10500,
    original_price: 13000,
    currency: KES,
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
    price: 24500,
    currency: KES,
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
  {
    id: "sms-us-01",
    slug: "usa-virtual-sms-number",
    name: "USA Virtual SMS Number",
    category: "sms",
    country_flags: "🇺🇸",
    price: 450,
    currency: KES,
    image: "/assets/images/sms-3d.svg",
    stock: 999,
    description: "US virtual number for one-time verification codes on any platform",
    specs: [
      "Works with WhatsApp, Telegram, Google, X",
      "Code arrives in 10-60 seconds",
      "Single-use, never recycled",
      "No personal details required",
    ],
    guide_url: "",
    badge: "Best Seller",
    featured: true,
    delivery: "Instant",
  },
  {
    id: "sms-uk-02",
    slug: "uk-virtual-sms-number",
    name: "UK Virtual SMS Number",
    category: "sms",
    country_flags: "🇬🇧",
    price: 500,
    currency: KES,
    image: "/assets/images/sms-3d.svg",
    stock: 999,
    description: "UK virtual number for platform verification and account creation",
    specs: [
      "UK (+44) number range",
      "Supports most major platforms",
      "Delivery typically under a minute",
    ],
    guide_url: "",
    delivery: "Instant",
  },
  {
    id: "sms-bulk-03",
    slug: "sms-verification-bulk-pack",
    name: "SMS Verification Bulk Pack (10 Numbers)",
    category: "sms",
    country_flags: "🇺🇸🇬🇧🇨🇦🇩🇪",
    price: 3800,
    original_price: 4500,
    currency: KES,
    image: "/assets/images/sms-3d.svg",
    stock: 500,
    description: "Ten mixed-region virtual numbers at a discounted bundle rate",
    specs: [
      "10 numbers, mixed US/UK/CA/DE",
      "Best per-number rate we offer",
      "Ideal for bulk account creation",
    ],
    guide_url: "",
    badge: "Restocked",
    delivery: "Instant",
  },
  {
    id: "sms-longterm-04",
    slug: "long-term-rental-sms-number",
    name: "Long-Term Rental SMS Number (30 Days)",
    category: "sms",
    country_flags: "🇺🇸",
    price: 2400,
    currency: KES,
    image: "/assets/images/sms-3d.svg",
    stock: 60,
    description: "Keep a US number for 30 days — unlimited inbound SMS",
    specs: [
      "30-day number retention",
      "Unlimited inbound verification codes",
      "Web dashboard access included",
    ],
    guide_url: "https://drive.google.com/",
    delivery: "Within 30 minutes",
  },

  /* --------------------------------- VPN -------------------------------- */
  {
    id: "vpn-nord-1y",
    slug: "nordvpn-1-year-premium",
    name: "NordVPN 1 Year Premium Account",
    category: "vpn",
    country_flags: "🛡️",
    price: 4500,
    original_price: 9800,
    currency: KES,
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
    price: 2600,
    currency: KES,
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
    price: 6200,
    currency: KES,
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
    price: 6000,
    currency: KES,
    image: "/assets/images/proxy-logo.svg",
    stock: 999,
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
  },
  {
    id: "proxy-rot-01",
    slug: "rotating-residential-proxies-5gb",
    name: "Rotating Residential Proxies — 5GB",
    category: "proxy",
    country_flags: "🌐",
    price: 3400,
    currency: KES,
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
    price: 7200,
    currency: KES,
    image: "/assets/images/proxy-logo.svg",
    stock: 9,
    description: "Premium 4G mobile proxies on US carrier networks",
    specs: [
      "5 dedicated 4G mobile IPs",
      "Carrier-grade NAT, highest trust score",
      "Perfect for social media automation",
    ],
    guide_url: "https://drive.google.com/",
    badge: "Hot",
    delivery: "Within 1 hour",
  },
  {
    id: "proxy-dc-03",
    slug: "datacenter-proxies-25ips",
    name: "Datacenter Proxies — 25 IPs",
    category: "proxy",
    country_flags: "🌐",
    price: 2200,
    currency: KES,
    image: "/assets/images/proxy-logo.svg",
    stock: 320,
    description: "Fast datacenter proxies for scraping and bulk requests",
    specs: [
      "25 datacenter IPs",
      "Gigabit throughput",
      "API-based rotation",
    ],
    guide_url: "",
    delivery: "Instant",
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
      list = [...list].sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      list = [...list].sort((a, b) => b.price - a.price);
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
  min: Math.min(...products.map((p) => p.price)),
  max: Math.max(...products.map((p) => p.price)),
};
