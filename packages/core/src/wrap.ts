import { type Context, createContext, createElement, type ReactNode } from "react";
import { type PulumiResourceConstructor, registerResource } from "./registry.js";

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
  if (
    pkg === "__react_pulumi_root__" ||
    pkg === "__component__" ||
    pkg === "__react_pulumi_group__"
  )
    return null;
  return pkg;
}

/**
 * Extract the args type from a Pulumi resource constructor.
 * e.g. `new (name: string, args: RandomPetArgs, opts?: ...) => ...` → `RandomPetArgs`
 */
type ExtractArgs<T> = T extends new (
  name: string,
  args: infer A,
  ...rest: unknown[]
) => unknown
  ? A
  : Record<string, unknown>;

/**
 * Pulumi resource options that can be set via the `opts` JSX prop.
 */
export interface ResourceOpts {
  protect?: boolean;
  ignoreChanges?: string[];
  replaceOnChanges?: string[];
  deleteBeforeReplace?: boolean;
  retainOnDelete?: boolean;
  aliases?: string[];
  provider?: unknown;
  dependsOn?: unknown[];
  customTimeouts?: { create?: string; update?: string; delete?: string };
  parent?: unknown;
  [key: string]: unknown;
}

/**
 * Props exposed in JSX for a wrapped Pulumi resource.
 * - All resource args (from the constructor's second parameter)
 * - `name` overrides the Pulumi logical name (defaults to type token)
 * - `opts` for Pulumi resource options (protect, provider, dependsOn, etc.)
 * - `children` for nesting — ReactNode or render-prop function
 */
export type ResourceProps<T extends PulumiResourceConstructor> = Partial<ExtractArgs<T>> & {
  name?: string;
  opts?: ResourceOpts;
  children?: ReactNode | ((instance: InstanceType<T>) => ReactNode);
};

/**
 * Wraps a Pulumi resource class so it can be used as a React component.
 *
 * Returns `[Component, Context]`:
 * - Component: React FC that creates the Pulumi resource at render time
 *   and provides the instance via Context.
 * - Context: React Context for descendants to read the instance via `useContext`.
 *
 * Supports two children modes:
 * - Context mode: `<Vcn name="x"><SubnetLayer /></Vcn>` — descendants use `useContext(VcnCtx)`
 * - Render props: `<Vcn name="x">{(vcn) => <Subnet vcnId={vcn.id} />}</Vcn>`
 *
 * Usage:
 * ```tsx
 * const [Bucket, BucketCtx] = pulumiToComponent(aws.s3.Bucket);
 * // <Bucket name="my-bucket" versioning={true} />
 * // Descendants: const bucket = useContext(BucketCtx);
 * ```
 */
export function pulumiToComponent<T extends PulumiResourceConstructor>(
  ResourceClass: T,
  typeToken?: string,
): [React.FC<ResourceProps<T>>, Context<InstanceType<T>>] {
  const token = typeToken ?? (ResourceClass as unknown as { __pulumiType?: string }).__pulumiType;

  if (!token) {
    throw new Error(
      `Cannot determine type token for ${ResourceClass.name ?? "resource"}. ` +
        `Pass it explicitly: pulumiToComponent(MyResource, "pkg:module:Type")`,
    );
  }

  // Keep registry populated for CLI backward compat + viz
  registerResource(token, ResourceClass);

  const ResourceContext = createContext<InstanceType<T>>(null as InstanceType<T>);

  function ResourceComponent(props: ResourceProps<T>) {
    const { name, children, opts, ...args } = props;
    const resourceName = (name as string) ?? token;

    let instance: InstanceType<T>;
    try {
      instance = new ResourceClass(resourceName, args, opts ?? {}) as InstanceType<T>;
    } catch {
      // Outside a Pulumi program (e.g. viz mode), resource constructors throw.
      // Return a stub so the component tree still renders for visualization.
      instance = { __pulumiType: token, name: resourceName, args } as InstanceType<T>;
    }

    const content =
      typeof children === "function"
        ? (children as (instance: InstanceType<T>) => ReactNode)(instance)
        : children;

    return createElement(ResourceContext.Provider, { value: instance }, content);
  }

  ResourceComponent.displayName = token;

  return [ResourceComponent as React.FC<ResourceProps<T>>, ResourceContext];
}
