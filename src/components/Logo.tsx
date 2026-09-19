import Link from "next/link";
import { BRAND } from "@/lib/config";

interface LogoProps {
  /** Renders as a link to the storefront unless `href` is null. */
  href?: string | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const SIZES = {
  sm: "text-sm",
  md: "text-lg sm:text-xl",
  lg: "text-2xl sm:text-3xl",
} as const;

export default function Logo({ href = "/", className = "", size = "md" }: LogoProps) {
  const content = (
    <span
      className={`font-extrabold tracking-tight uppercase whitespace-nowrap ${SIZES[size]} ${className}`}
    >
      {BRAND.nameLead}
      <span className="text-[var(--color-brand)]">{BRAND.nameAccent}</span>
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} aria-label={`${BRAND.fullName} home`} className="inline-flex items-center">
      {content}
    </Link>
  );
}
