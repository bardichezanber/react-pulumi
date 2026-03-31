/**
 * Module-level registry for VizInput/VizButton controls.
 * Components register synchronously during render.
 * The viz server reads this registry to serve GET /api/viz-controls.
 */

import type { VizControlDescriptor } from "./viz-types.js";

export interface VizControlEntry extends VizControlDescriptor {
  setValue?: (value: unknown) => void;
  handler?: () => void | Promise<void>;
}

class VizRegistryImpl {
  private controls = new Map<string, VizControlEntry>();
  private _locked = false;

  register(entry: VizControlEntry): void {
    // When locked, ignore re-registrations from React's deferred render phases.
    // ConcurrentRoot may re-render components after flushSyncWork(), creating
    // setters with wrong hook indices that would overwrite the correct ones.
    if (this._locked) return;
    this.controls.set(entry.name, entry);
  }

  /**
   * Lock the registry to prevent deferred re-registrations.
   * Call after the synchronous render completes but before React's
   * ConcurrentRoot deferred work runs.
   */
  lock(): void {
    this._locked = true;
  }

  unlock(): void {
    this._locked = false;
  }

  unregister(name: string): void {
    this.controls.delete(name);
  }

  get(name: string): VizControlEntry | undefined {
    return this.controls.get(name);
  }

  list(): VizControlDescriptor[] {
    return Array.from(this.controls.values()).map(
      ({ setValue, handler, ...descriptor }) => descriptor,
    );
  }

  async invoke(name: string, value?: unknown): Promise<void> {
    const entry = this.controls.get(name);
    if (!entry) throw new Error(`Viz control "${name}" not found`);
    if (entry.controlType === "button" && entry.handler) {
      await entry.handler();
    } else if (entry.controlType === "input" && entry.setValue) {
      entry.setValue(value);
    }
  }

  reset(): void {
    this.controls.clear();
  }

  get size(): number {
    return this.controls.size;
  }
}

// Use globalThis to ensure a single instance across module duplicates
// (tsx + pnpm can load the same module from different paths, creating separate instances)
const GLOBAL_KEY = Symbol.for("react-pulumi:vizRegistry");
const g = globalThis as unknown as Record<symbol, VizRegistryImpl>;

export const vizRegistry: VizRegistryImpl = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new VizRegistryImpl());
