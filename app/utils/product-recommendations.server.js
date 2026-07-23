export function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function parseJSON(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function escapeQueryValue(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

const PRODUCT_METAFIELDS = `
  gender: metafield(namespace: "custom", key: "gender") {
    value
  }
  category: metafield(namespace: "custom", key: "category") {
    value
  }
  silhouette: metafield(namespace: "custom", key: "silhouette") {
    value
  }
  colors: metafield(namespace: "custom", key: "colors") {
    value
  }
  colorSwatchMap: metafield(namespace: "custom", key: "color_swatch_map") {
    value
  }
  colorSwatchMapAr: metafield(namespace: "custom", key: "color_swatch_map_ar") {
    value
  }
`;

export async function getCurrentProduct(admin, handle) {
  const response = await admin.graphql(
    `
      query CurrentProduct($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            title
            handle
            vendor
            ${PRODUCT_METAFIELDS}
          }
        }
      }
    `,
    {
      variables: {
        query: `handle:${escapeQueryValue(handle)}`,
      },
    },
  );

  const json = await response.json();
  return json.data?.products?.nodes?.[0] ?? null;
}

export async function getAllProducts(admin, { vendor } = {}) {
  let searchQuery = "inventory_total:>0";
  if (vendor) {
    searchQuery += ` AND vendor:"${escapeQueryValue(vendor)}"`;
  }

  const allProducts = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `
        query Products($cursor: String, $query: String) {
          products(first: 250, after: $cursor, query: $query) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                handle
                vendor
                featuredImage {
                  url
                }
                ${PRODUCT_METAFIELDS}
              }
            }
          }
        }
      `,
      {
        variables: { cursor, query: searchQuery },
      },
    );

    const json = await response.json();
    const products = json.data.products;

    allProducts.push(...products.edges.map((e) => e.node));
    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  return allProducts;
}

export function formatProduct(product) {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    image: product.featuredImage?.url,
    brand: normalize(product.vendor),
    gender: normalize(product.gender?.value),
    category: normalize(product.category?.value),
    silhouette: normalize(product.silhouette?.value),
    colors: normalize(product.colors?.value),
    colorSwatchMap: parseJSON(product.colorSwatchMap?.value),
    colorSwatchMapAr: parseJSON(product.colorSwatchMapAr?.value),
  };
}

function matchesRules(product, rules) {
  return Object.entries(rules).every(([key, value]) => {
    if (!value) return true;
    return product[key] === normalize(value);
  });
}

export function buildTieredRecommendations(
  products,
  criteria,
  tiers,
  threshold = 4,
) {
  const recommendations = [];
  const seenIds = new Set();

  for (const tierKeys of tiers) {
    if (recommendations.length >= threshold) break;

    const rules = Object.fromEntries(
      tierKeys.map((key) => [key, criteria[key]]),
    );

    for (const product of products) {
      if (seenIds.has(product.id)) continue;
      if (matchesRules(product, rules)) {
        recommendations.push(product);
        seenIds.add(product.id);
      }
    }
  }

  return recommendations;
}

export async function resolveCurrentProduct(admin, request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle");

  if (!handle) {
    return {
      error: Response.json(
        { error: "Missing product handle" },
        { status: 400 },
      ),
    };
  }

  const currentProduct = await getCurrentProduct(admin, handle);

  if (!currentProduct) {
    return {
      error: Response.json({ error: "Product not found" }, { status: 404 }),
    };
  }

  return { currentProduct };
}
