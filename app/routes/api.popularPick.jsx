import { authenticate } from "../shopify.server";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function match(product, rules) {
  //   if (rules.brand && product.brand !== normalize(rules.brand)) return false;
  if (rules.gender && product.gender !== normalize(rules.gender)) return false;
  //   if (rules.category && product.category !== normalize(rules.category))
  // return false;
  //   if (rules.silhouette && product.silhouette !== normalize(rules.silhouette))
  // return false;
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
  };

  function parseJSON(value) {
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  // Fetch all products (paginated)
  let allProducts = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `
        query Products($cursor: String) {
          products(first: 250, after: $cursor, sortKey: TITLE) {
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
      colorSwatchMap: parseJSON(product.colorSwatchMap?.value),
      colorSwatchMapAr: parseJSON(product.colorSwatchMapAr?.value),
    }));

  const recommendations = formattedProducts.filter((p) =>
    match(p, {
      brand: criteria.brand,
      gender: criteria.gender,
    }),
  );

  return Response.json({
    products: recommendations.slice(0, 4),
  });
}
