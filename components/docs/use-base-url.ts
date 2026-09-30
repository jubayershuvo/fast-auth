"use client";

import { useSyncExternalStore } from "react";

import { BASE_URL_PLACEHOLDER } from "@/lib/api-docs/base-url";

const noopSubscribe = () => () => {};

/**
 * The origin the reader is currently on, e.g. `https://auth.example.com`.
 *
 * Uses `useSyncExternalStore` rather than `useState` + `useEffect`: the
 * server snapshot returns the placeholder and the client snapshot returns the
 * real origin, so React hydrates without a mismatch warning and without a
 * cascading second render.
 */
export function useBaseUrl(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => BASE_URL_PLACEHOLDER,
  );
}
