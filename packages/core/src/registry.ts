/**
 * Global registry mapping Pulumi type tokens → resource class constructors.
 * Populated by `pulumiToComponent()` in wrap.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PulumiResourceConstructor {
  new (name: string, args: any, opts?: any): unknown;
}

const registry = new Map<string, PulumiResourceConstructor>();

export function registerResource(typeToken: string, ctor: PulumiResourceConstructor): void {
  registry.set(typeToken, ctor);
}

export function getResourceClass(typeToken: string): PulumiResourceConstructor | undefined {
  return registry.get(typeToken);
}

export function getRegistry(): ReadonlyMap<string, PulumiResourceConstructor> {
  return registry;
}
