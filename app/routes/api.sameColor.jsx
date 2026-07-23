import { authenticate } from "../shopify.server";
import {
  getAllProducts,
  formatProduct,
  buildTieredRecommendations,
  resolveCurrentProduct,
} from "../utils/product-recommendations.server";

const TIERS = [
  ["brand", "gender", "category", "colors"],
  ["brand", "gender", "category"],
  ["brand", "gender"],
  ["brand"],
];

export async function loader({ request }) {
  try {
    const { admin } = await authenticate.public.appProxy(request);

    const { currentProduct, error } = await resolveCurrentProduct(
      admin,
      request,
    );
    if (error) return error;

    const criteria = {
      brand: currentProduct.vendor,
      gender: currentProduct.gender?.value || "",
      category: currentProduct.category?.value || "",
      colors: currentProduct.colors?.value || "",
    };

    const allProducts = await getAllProducts(admin, {
      vendor: currentProduct.vendor,
    });

    const formattedProducts = allProducts
      .filter((p) => p.id !== currentProduct.id)
      .map(formatProduct);

    const recommendations = buildTieredRecommendations(
      formattedProducts,
      criteria,
      TIERS,
    );

    return Response.json({ products: recommendations });
  } catch (err) {
    console.error("sameColor loader failed", err);
    return Response.json(
      { error: "Failed to load recommendations" },
      { status: 500 },
    );
  }
}
