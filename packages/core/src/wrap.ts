import type { ReactNode } from "react";
import { registerResource, type PulumiResourceConstructor } from "./registry.js";

/**
 * Extract the package name from a provider type token.
 * "pulumi:providers:aws" → "aws", anything else → null
 */
export function extractProviderPackage(typeToken: string): string | null {
  const match = typeToken.match(/^pulumi:providers:(.+)$/);
  return match ? match[1] : null;
}

/**
 * Extract the package name from a resource type token.
 * "aws:s3:Bucket" → "aws", "aws:s3/bucketV2:BucketV2" → "aws"
 */
export function extractResourcePackage(typeToken: string): string | null {
  const idx = typeToken.indexOf(":");
  if (idx <= 0) return null;
  const pkg = typeToken.substring(0, idx);
  // Skip internal tokens
  if (pkg === "__react_pulumi_root__" || pkg === "__component__" || pkg === "__react_pulumi_group__") return null;
  return pkg;
}

/**
 * Extract the args type from a Pulumi resource constructor.
 * e.g. `new (name: string, args: RandomPetArgs, opts?: ...) => ...` → `RandomPetArgs`
 */
type ExtractArgs<T> =
  T extends new (name: string, args: infer A, ...rest: unknown[]) => unknown
    ? A
    : Record<string, unknown>;

/**
 * Pulumi resource options that can be set via the `opts` JSX prop.
 * These are stripped by the reconciler and stored on the ResourceNode,
 * then merged into Pulumi opts during materialization.
 */
export interface ResourceOpts {
  protect?: boolean;
  ignoreChanges?: string[];
  replaceOnChanges?: string[];
  deleteBeforeReplace?: boolean;
  retainOnDelete?: boolean;
  aliases?: string[];
  /** Override provider by name (resolved during materialization) */
  provider?: string;
  /** Explicit dependencies by resource name (resolved during materialization) */
  dependsOn?: string[];
  customTimeouts?: { create?: string; update?: string; delete?: string };
}

/**
 * Props exposed in JSX for a wrapped Pulumi resource.
 * - All resource args (from the constructor's second parameter)
 * - `name` overrides the Pulumi logical name (defaults to type token)
 * - `opts` for Pulumi resource options (protect, ignoreChanges, etc.)
 * - `children` for nesting (React standard)
 */
type ResourceProps<T> = Partial<ExtractArgs<T>> & {
  name?: string;
  opts?: ResourceOpts;
  children?: ReactNode;
};

/**
 * A branded function component type so TypeScript treats the returned string
 * as a valid JSX element type with proper prop types.
 */
interface ResourceComponent<T> {
  (props: ResourceProps<T>): null;
  displayName?: string;
}

/**
 * Wraps a Pulumi resource class so it can be used as a React host component.
 *
 * The type token is auto-extracted from the class's `__pulumiType` static
 * property (present on all Pulumi resource classes). You can override it
 * by passing an explicit `typeToken`.
 *
 * Usage:
 *   const RandomPet = pulumiToComponent(random.RandomPet);
 *   // then in JSX: <RandomPet name="my-pet" length={3} />
 */
export function pulumiToComponent<T extends PulumiResourceConstructor>(
  ResourceClass: T,
  typeToken?: string,
): ResourceComponent<T> {
  const token =
    typeToken ??
    (ResourceClass as unknown as { __pulumiType?: string }).__pulumiType;

  if (!token) {
    throw new Error(
      `Cannot determine type token for ${ResourceClass.name ?? "resource"}. ` +
        `Pass it explicitly: pulumiToComponent(MyResource, "pkg:module:Type")`,
    );
  }

  registerResource(token, ResourceClass);
  return token as unknown as ResourceComponent<T>;
}
