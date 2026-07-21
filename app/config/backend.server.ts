const BASE_URL = process.env.BACKEND_URL ?? "";

/**
 * Builds an absolute URL from BACKEND_URL + path with optional query params.
 */
export function getBackendUrl(
  path: string,
  params?: Record<string, string>,
): string {
  if (!BASE_URL) {
    throw new Error(
      "BACKEND_URL environment variable is not set. Add it to your .env file.",
    );
  }
  const url = new URL(path, BASE_URL);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return url.toString();
}

/**
 * Common headers for all backend API requests.
 * Includes Authorization when BACKEND_API_KEY is set.
 */
export const BACKEND_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  ...(process.env.BACKEND_API_KEY
    ? { Authorization: process.env.BACKEND_API_KEY }
    : {}),
};
