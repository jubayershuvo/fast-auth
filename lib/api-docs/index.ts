import type { EndpointDoc, GroupId } from "./types";
import { V1_ENDPOINTS } from "./v1";
import { KEY_ENDPOINTS } from "./keys";
import { DASHBOARD_ENDPOINTS } from "./dashboard";
import { ADMIN_ENDPOINTS } from "./admin";
import { PORTAL_ENDPOINTS } from "./portal";

/**
 * The aggregated API reference.
 *
 * Both the in-app docs and the generated OpenAPI spec read from here, so the
 * two can never disagree about what the API looks like.
 *
 * Order is also the reading order on /docs: public API, then API keys, then
 * the dashboard, then the end-user portal, then the operator surface.
 */
export const ALL_ENDPOINTS: EndpointDoc[] = [
  ...V1_ENDPOINTS,
  ...KEY_ENDPOINTS,
  ...DASHBOARD_ENDPOINTS,
  ...PORTAL_ENDPOINTS,
  ...ADMIN_ENDPOINTS,
];

export function endpointsByGroup(group: GroupId): EndpointDoc[] {
  return ALL_ENDPOINTS.filter((endpoint) => endpoint.group === group);
}

export function getEndpoint(id: string): EndpointDoc | undefined {
  return ALL_ENDPOINTS.find((endpoint) => endpoint.id === id);
}

export * from "./types";
