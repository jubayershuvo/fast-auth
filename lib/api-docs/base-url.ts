/**
 * Isomorphic base-URL handling for the API reference.
 *
 * The endpoint catalogue must NOT hardcode a domain: this platform is
 * self-hosted, so the correct origin is whatever host the reader is currently
 * on. Examples therefore carry `{{BASE_URL}}`, and it is substituted at render
 * time:
 *
 *  - in the browser, from `window.location.origin` (see useBaseUrl);
 *  - in the generated OpenAPI document, from the incoming request's origin.
 *
 * Keeping the placeholder literal means that even if substitution ever fails,
 * the reader sees an obvious placeholder instead of a wrong domain.
 */

export const BASE_URL_PLACEHOLDER = "{{BASE_URL}}";

/** Replace every placeholder occurrence in a block of text. */
export function substituteBaseUrl(text: string, baseUrl: string): string {
  if (!text.includes(BASE_URL_PLACEHOLDER)) return text;
  return text.split(BASE_URL_PLACEHOLDER).join(baseUrl);
}
