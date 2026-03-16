/**
 * useConfig — read Pulumi stack config values during render.
 *
 * Works in one-shot mode (`renderToPulumi`). In the future, daemon mode
 * will watch config changes and trigger re-renders.
 *
 * Supports namespaced keys:
 *   useConfig("replicas")     → reads from project namespace
 *   useConfig("aws:region")   → reads from "aws" namespace
 *
 * Requires `setPulumiSDK(pulumi)` to have been called before render.
 */

import { getPulumiSDK } from "../pulumi-bridge.js";

// Cache Config instances per namespace to avoid repeated construction
const configCache = new Map<string, unknown>();

function parseConfigKey(key: string): { namespace: string | undefined; configKey: string } {
  const colonIdx = key.indexOf(":");
  if (colonIdx > 0) {
    return { namespace: key.substring(0, colonIdx), configKey: key.substring(colonIdx + 1) };
  }
  return { namespace: undefined, configKey: key };
}

function getOrCreateConfig(namespace?: string): { get(key: string): string | undefined } {
  const cacheKey = namespace ?? "__default__";
  let config = configCache.get(cacheKey);
  if (!config) {
    const pulumi = getPulumiSDK();
    config = namespace ? new pulumi.Config(namespace) : new pulumi.Config();
    configCache.set(cacheKey, config);
  }
  return config as { get(key: string): string | undefined };
}

/**
 * Read a value from Pulumi stack config.
 *
 * ```tsx
 * const region = useConfig("aws:region");           // string | undefined
 * const replicas = useConfig("replicas", "2");      // string (default "2")
 * ```
 */
export function useConfig(key: string, defaultValue?: string): string | undefined {
  const { namespace, configKey } = parseConfigKey(key);
  const config = getOrCreateConfig(namespace);
  const value = config.get(configKey);
  return value ?? defaultValue;
}

/**
 * Reset the Config instance cache. Called between renders by `renderToPulumi`.
 */
export function resetConfigCache(): void {
  configCache.clear();
}
