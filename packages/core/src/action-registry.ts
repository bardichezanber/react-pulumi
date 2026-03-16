export interface ActionEntry {
  name: string;
  handler: (...args: unknown[]) => unknown | Promise<unknown>;
  description?: string;
}

class ActionRegistryImpl {
  private actions = new Map<string, ActionEntry>();

  register(
    name: string,
    handler: (...args: unknown[]) => unknown | Promise<unknown>,
    description?: string,
  ): void {
    this.actions.set(name, { name, handler, description });
  }

  unregister(name: string): void {
    this.actions.delete(name);
  }

  get(name: string): ActionEntry | undefined {
    return this.actions.get(name);
  }

  list(): ActionEntry[] {
    return Array.from(this.actions.values());
  }

  async invoke(name: string, ...args: unknown[]): Promise<unknown> {
    const entry = this.actions.get(name);
    if (!entry) {
      throw new Error(`Action "${name}" not found`);
    }
    return entry.handler(...args);
  }
}

export const actionRegistry = new ActionRegistryImpl();
