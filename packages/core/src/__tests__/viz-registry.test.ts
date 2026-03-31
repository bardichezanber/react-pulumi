import { afterEach, describe, expect, it, vi } from "vitest";
import { vizRegistry } from "../viz-registry.js";

afterEach(() => {
  vizRegistry.reset();
});

describe("vizRegistry", () => {
  it("register adds entry, list returns descriptor", () => {
    vizRegistry.register({
      name: "replicas",
      controlType: "input",
      label: "Replicas",
      inputType: "number",
      value: 2,
      setValue: () => {},
    });

    const list = vizRegistry.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("replicas");
    expect(list[0].controlType).toBe("input");
    // setValue should NOT be in the descriptor
    expect((list[0] as Record<string, unknown>).setValue).toBeUndefined();
  });

  it("unregister removes entry", () => {
    vizRegistry.register({ name: "btn", controlType: "button", handler: () => {} });
    expect(vizRegistry.size).toBe(1);

    vizRegistry.unregister("btn");
    expect(vizRegistry.size).toBe(0);
  });

  it("invoke calls button handler", async () => {
    const handler = vi.fn();
    vizRegistry.register({ name: "scale-up", controlType: "button", handler });

    await vizRegistry.invoke("scale-up");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("invoke calls input setValue with value", async () => {
    const setValue = vi.fn();
    vizRegistry.register({ name: "count", controlType: "input", value: 1, setValue });

    await vizRegistry.invoke("count", 5);
    expect(setValue).toHaveBeenCalledWith(5);
  });

  it("invoke throws for unknown name", async () => {
    await expect(vizRegistry.invoke("nonexistent")).rejects.toThrow("not found");
  });

  it("list returns empty array when empty", () => {
    expect(vizRegistry.list()).toEqual([]);
  });

  it("list strips handler and setValue from descriptors", () => {
    vizRegistry.register({
      name: "btn",
      controlType: "button",
      label: "Click me",
      description: "Does stuff",
      handler: () => {},
    });

    const desc = vizRegistry.list()[0];
    expect(desc.label).toBe("Click me");
    expect((desc as Record<string, unknown>).handler).toBeUndefined();
  });

  it("get returns entry with handler", () => {
    const handler = vi.fn();
    vizRegistry.register({ name: "btn", controlType: "button", handler });

    const entry = vizRegistry.get("btn");
    expect(entry?.handler).toBe(handler);
  });

  it("reset clears all entries", () => {
    vizRegistry.register({ name: "a", controlType: "button", handler: () => {} });
    vizRegistry.register({ name: "b", controlType: "input", value: 1, setValue: () => {} });
    expect(vizRegistry.size).toBe(2);

    vizRegistry.reset();
    expect(vizRegistry.size).toBe(0);
  });
});
