import { beforeEach, describe, expect, it } from "vitest";
import { collectState, getNextValue, loadState, resetState, trackValue } from "../state-store.js";

beforeEach(() => {
  resetState();
});

describe("state-store", () => {
  describe("loadState + getNextValue", () => {
    it("returns default values when no persisted state", () => {
      loadState({ keys: [], values: [] });

      const { index: i0, value: v0 } = getNextValue(42);
      const { index: i1, value: v1 } = getNextValue("hello");

      expect(i0).toBe(0);
      expect(v0).toBe(42);
      expect(i1).toBe(1);
      expect(v1).toBe("hello");
    });

    it("returns persisted values when available", () => {
      loadState({ keys: ["App:0", "App:1"], values: [99, "world"] });

      const { value: v0 } = getNextValue(42);
      const { value: v1 } = getNextValue("hello");

      expect(v0).toBe(99);
      expect(v1).toBe("world");
    });

    it("falls back to default when index exceeds persisted values", () => {
      loadState({ keys: ["App:0"], values: [99] });

      const { value: v0 } = getNextValue(42);
      const { value: v1 } = getNextValue("hello");

      expect(v0).toBe(99);
      expect(v1).toBe("hello");
    });

    it("handles boolean persisted values", () => {
      loadState({ keys: ["App:0"], values: [true] });

      const { value } = getNextValue(false);
      expect(value).toBe(true);
    });

    it("handles null persisted values", () => {
      loadState({ keys: ["App:0"], values: [null] });

      const { value } = getNextValue("fallback");
      expect(value).toBeNull();
    });

    it("handles object persisted values", () => {
      const obj = { a: 1, b: [2, 3] };
      loadState({ keys: ["App:0"], values: [obj] });

      const { value } = getNextValue({});
      expect(value).toEqual({ a: 1, b: [2, 3] });
    });

    it("increments index monotonically", () => {
      loadState({ keys: [], values: [] });

      const r0 = getNextValue("a");
      const r1 = getNextValue("b");
      const r2 = getNextValue("c");

      expect(r0.index).toBe(0);
      expect(r1.index).toBe(1);
      expect(r2.index).toBe(2);
    });
  });

  describe("trackValue", () => {
    it("updates pending values at specific index", () => {
      loadState({ keys: ["App:0"], values: [10] });

      const { index } = getNextValue(0);
      trackValue(index, 20);

      const state = collectState(["App:0"]);
      expect(state.values).toEqual([20]);
    });

    it("overwrites multiple times at same index", () => {
      loadState({ keys: ["App:0"], values: [10] });

      const { index } = getNextValue(0);
      trackValue(index, 20);
      trackValue(index, 30);
      trackValue(index, 40);

      const state = collectState(["App:0"]);
      expect(state.values).toEqual([40]);
    });

    it("tracks values at multiple indices independently", () => {
      loadState({ keys: [], values: [] });

      const r0 = getNextValue(1);
      const _r1 = getNextValue(2);
      const r2 = getNextValue(3);

      trackValue(r0.index, 10);
      trackValue(r2.index, 30);
      // r1 not tracked — keeps default

      const state = collectState(["A:0", "A:1", "A:2"]);
      expect(state.values).toEqual([10, 2, 30]);
    });
  });

  describe("collectState", () => {
    it("returns keys and values with correct length", () => {
      loadState({ keys: [], values: [] });

      getNextValue(1);
      getNextValue("a");
      trackValue(0, 5);

      const state = collectState(["Comp:0", "Comp:1"]);
      expect(state.keys).toEqual(["Comp:0", "Comp:1"]);
      expect(state.values).toEqual([5, "a"]);
    });

    it("truncates values to match keys length", () => {
      loadState({ keys: [], values: [] });

      getNextValue(1);
      getNextValue(2);
      getNextValue(3);

      // Only 2 keys — should truncate to 2 values
      const state = collectState(["A:0", "A:1"]);
      expect(state.values).toHaveLength(2);
      expect(state.values).toEqual([1, 2]);
    });

    it("returns empty state when no hooks", () => {
      loadState({ keys: [], values: [] });

      const state = collectState([]);
      expect(state.keys).toEqual([]);
      expect(state.values).toEqual([]);
    });
  });

  describe("resetState", () => {
    it("clears everything", () => {
      loadState({ keys: ["App:0"], values: [99] });
      getNextValue(0);
      resetState();

      const { index, value } = getNextValue(42);
      expect(index).toBe(0);
      expect(value).toBe(42);
    });

    it("clears pending values", () => {
      loadState({ keys: [], values: [] });
      getNextValue(1);
      trackValue(0, 100);
      resetState();

      // After reset, collectState should return empty
      const state = collectState([]);
      expect(state.values).toEqual([]);
    });
  });

  describe("loadState resets counter", () => {
    it("resets hookCounter on re-load", () => {
      loadState({ keys: ["A:0"], values: [10] });
      getNextValue(0); // index 0
      getNextValue(0); // index 1

      // Re-load — counter should reset
      loadState({ keys: ["A:0", "A:1"], values: [20, 30] });
      const { index, value } = getNextValue(0);
      expect(index).toBe(0);
      expect(value).toBe(20);
    });
  });
});
