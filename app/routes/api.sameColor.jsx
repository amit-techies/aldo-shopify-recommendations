import { authenticate } from "../shopify.server";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function match(product, rules) {
  if (rules.brand && product.brand !== normalize(rules.brand)) return false;
  if (rules.gender && product.gender !== normalize(rules.gender)) return false;
  if (rules.category && product.category !== normalize(rules.category))
    return false;
  if (rules.colors && product.colors !== normalize(rules.colors)) return false;
  return true;
}

export async function loader({ request }) {
  console.log("inside proxy in recommend");

  const url = new URL(request.url);
  const handle = url.searchParams.get("handle");

  if (!handle) {
    return Response.json({ error: "Missing product handle" }, { status: 400 });
  }

  const { admin } = await authenticate.public.appProxy(request);

  const currentProductResponse = await admin.graphql(
    `
    query CurrentProduct($query: String!) {
      products(first: 1, query: $query) {
        nodes {
          id
          title
          handle
          vendor

          gender: metafield(namespace: "custom", key: "gender") {
            value
          }

          category: metafield(namespace: "custom", key: "category") {
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
        }
      }
    }
  `,
    {
      variables: {
        query: `handle:${handle}`,
      },
    },
  );

  const currentProductJson = await currentProductResponse.json();

  const currentProduct =
    currentProductJson.data.products.nodes.length > 0
      ? currentProductJson.data.products.nodes[0]
      : null;

  if (!currentProduct) {
    return Response.json({ error: "Product not found" }, { status: 404 });
  }

  const criteria = {
    brand: currentProduct.vendor,
    gender: currentProduct.gender?.value || "",
    category: currentProduct.category?.value || "",
    colors: currentProduct.colors?.value || "",
  };

  // Fetch all products (paginated)
  let allProducts = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `
      query Products($cursor: String) {
        products(first: 250, after: $cursor,  query: "inventory_total:>0") {
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

              gender: metafield(namespace: "custom", key: "gender") {
                value
              }

              category: metafield(namespace: "custom", key: "category") {
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
            }
          }
        }
      }
    `,
      {
        variables: {
          cursor,
        },
      },
    );

    const {
      data: { products },
    } = await response.json();

    allProducts.push(...products.edges.map((e) => e.node));

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  const formattedProducts = allProducts
    .filter((p) => p.id !== currentProduct.id)
    .map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      image: product.featuredImage?.url,
      brand: normalize(product.vendor),
      gender: normalize(product.gender?.value),
      category: normalize(product.category?.value),
      colors: product.colors?.value,
      colorSwatchMap: (() => {
        try {
          return product.colorSwatchMapAr?.value
            ? JSON.parse(product.colorSwatchMapAr.value)
            : null;
        } catch {
          return null;
        }
      })(),
      colorSwatchMapAr: (() => {
        try {
          return product.colorSwatchMap?.value
            ? JSON.parse(product.colorSwatchMap.value)
            : null;
        } catch {
          return null;
        }
      })(),
    }));

  const recommendations = [];

  // Tier 1
  recommendations.push(
    ...formattedProducts.filter((p) =>
      match(p, {
        brand: criteria.brand,
        gender: criteria.gender,
        category: criteria.category,
        colors: criteria.colors,
      }),
    ),
  );

  // Tier 2
  if (recommendations.length < 4) {
    recommendations.push(
      ...formattedProducts.filter(
        (p) =>
          match(p, {
            brand: criteria.brand,
            gender: criteria.gender,
            category: criteria.category,
          }) && !recommendations.some((r) => r.id === p.id),
      ),
    );
  }

  // Tier 3
  if (recommendations.length < 4) {
    recommendations.push(
      ...formattedProducts.filter(
        (p) =>
          match(p, {
            brand: criteria.brand,
            gender: criteria.gender,
          }) && !recommendations.some((r) => r.id === p.id),
      ),
    );
  }

  // Tier 4
  if (recommendations.length < 4) {
    recommendations.push(
      ...formattedProducts.filter(
        (p) =>
          match(p, {
            brand: criteria.brand,
          }) && !recommendations.some((r) => r.id === p.id),
      ),
    );
  }

  return Response.json({
    products: recommendations.slice(0, 10),
  });
}
