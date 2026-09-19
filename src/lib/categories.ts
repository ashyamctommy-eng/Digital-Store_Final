export interface Category {
  /** Stable id, also used as the filter key in URLs and search. */
  id: string;
  /** Display name, e.g. "Facebook Accounts". */
  name: string;
  /** Short line shown under the banner title. */
  tagline: string;
  /** Emoji used as the banner icon (keeps the bundle free of icon sets). */
  icon: string;
  /** Tailwind gradient classes for the full-width category banner. */
  gradient: string;
}

export const categories: Category[] = [
  {
    id: "facebook",
    name: "Facebook Accounts",
    tagline: "Aged, verified profiles with email access",
    icon: "📘",
    gradient: "from-[#1877F2] to-[#0052CC]",
  },
  {
    id: "instagram",
    name: "Instagram Accounts",
    tagline: "Established pages ready to monetise",
    icon: "📸",
    gradient: "from-[#F58529] via-[#DD2A7B] to-[#8134AF]",
  },
  {
    id: "tiktok",
    name: "TikTok Accounts",
    tagline: "Follower-loaded accounts for instant reach",
    icon: "🎵",
    gradient: "from-[#111827] to-[#FE2C55]",
  },
  {
    id: "sms",
    name: "SMS Verifications",
    tagline: "Virtual numbers for any platform",
    icon: "📲",
    gradient: "from-[#7C3AED] to-[#4C1D95]",
  },
  {
    id: "vpn",
    name: "Premium VPN",
    tagline: "Long-life subscriptions at a fraction of retail",
    icon: "🛡️",
    gradient: "from-[#0066FF] to-[#0052CC]",
  },
  {
    id: "proxy",
    name: "Proxies",
    tagline: "Residential, static and rotating IPs",
    icon: "🌐",
    gradient: "from-[#0F766E] to-[#134E4A]",
  },
];

export function getCategory(id: string): Category | undefined {
  return categories.find((c) => c.id === id);
}

/** Quick-filter chips shown under the search bar. */
export const popularTags: string[] = [
  "VPN",
  "Proxy",
  "Facebook",
  "Instagram",
  "SMS Numbers",
  "TikTok",
];

export const sortOptions = [
  { id: "popular", label: "Most popular" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
  { id: "new", label: "Newest first" },
] as const;

export type SortOption = (typeof sortOptions)[number]["id"];
