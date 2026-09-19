/**
 * Central site configuration: branding, support channels, commerce settings.
 * Everything a store owner would want to change lives here (or in the
 * product catalog) rather than being scattered across components.
 */

export const BRAND = {
  /** Rendered as two spans so the second part can carry the accent colour. */
  nameLead: "DIGITAL",
  nameAccent: "HUB SHOP",
  fullName: "Digital Hub Shop",
  tagline: "Instant delivery of accounts, verifications, VPNs & proxies.",
} as const;

export const SUPPORT = {
  /** International format, no "+", no spaces — used for wa.me links. */
  whatsapp: "254717702563",
  whatsappDisplay: "+254 717 702 563",
  telegram: "DigitalHubSupport",
  telegramUrl: "https://t.me/DigitalHubSupport",
  email: "support@digitalhub.shop",
  /** Shown by the "1-hour support" notice. */
  responseTime: "under 1 hour",
} as const;

export const COMMERCE = {
  /** Base currency for all catalog prices. */
  currency: "KES",
  symbol: "KSh",
  /**
   * Display currencies. `rate` is "1 KES = rate <code>", used only for
   * approximate price previews.
   */
  rates: {
    KES: 1,
    USD: 0.0077,
    NGN: 11.8,
  } as Record<string, number>,
  /** Wallet top-up presets, in base currency. */
  topUpPresets: [500, 1000, 2500, 5000],
} as const;

export const DELIVERY = {
  /** Headline promise shown in promo slots. */
  promise: "Instant Delivery",
  detail: "Accounts delivered to your dashboard within minutes of payment.",
  guarantee: "Replacement guarantee on any account that fails within 24 hours.",
} as const;

/**
 * Accounts allowed into /admin.
 *
 * This gate is a UI convenience only — it runs in the browser and can be
 * bypassed. Real protection must come from Firestore security rules scoped to
 * these same addresses.
 */
export const ADMIN_EMAILS: string[] = [
  "wildpharmtech9@gmail.com",
  "ashyamctommy@gmail.com",
];

/**
 * Announcement cards for the notice slider. `tone` maps to a palette in
 * the NoticeSlider component.
 */
export const NOTICES = [
  {
    id: "replacement",
    icon: "shield",
    tone: "amber" as const,
    title: "IMPORTANT NOTICE",
    body: "All accounts come with a 24-hour replacement guarantee. Report issues via Telegram or WhatsApp with your order ID.",
  },
  {
    id: "support",
    icon: "clock",
    tone: "blue" as const,
    title: "1-HOUR SUPPORT",
    body: `Our team replies in ${SUPPORT.responseTime}, 7 days a week. No bots, no waiting queues.`,
  },
  {
    id: "telegram",
    icon: "telegram",
    tone: "sky" as const,
    title: "JOIN TELEGRAM",
    body: `Get stock alerts, price drops and free drops first. Support handle: @${SUPPORT.telegram}`,
    href: SUPPORT.telegramUrl,
    cta: "Open Telegram",
  },
  {
    id: "whatsapp",
    icon: "whatsapp",
    tone: "green" as const,
    title: "WHATSAPP ORDERS",
    body: `Prefer to order manually? Message ${SUPPORT.whatsappDisplay} and we will deliver straight to your chat.`,
    href: `https://wa.me/${SUPPORT.whatsapp}`,
    cta: "Chat on WhatsApp",
  },
] as const;

export type Notice = (typeof NOTICES)[number];
