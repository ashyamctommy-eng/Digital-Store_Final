import StorefrontShell from "@/components/StorefrontShell";
import ProductDetailPage from "@/app/products/[slug]/page";

export default function LiveProductRoute() {
  return (
    <StorefrontShell>
      <ProductDetailPage />
    </StorefrontShell>
  );
}
