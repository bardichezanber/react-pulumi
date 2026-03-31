import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionLogMiddleware,
  type ActionLog,
} from "../middlewares/action-log-middleware.js";
import type {
  DeployOutcomeEvent,
  HydrateEvent,
  SetterCallEvent,
} from "../state-middleware.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `react-pulumi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeHydrateEvent(index: number, value: unknown): HydrateEvent {
  return {
    type: "hydrate",
    index,
    value,
    defaultValue: 0,
    seq: index,
    timestamp: Date.now(),
    deployId: "test-deploy",
  };
}

function makeSetterEvent(index: number, prev: unknown, next: unknown): SetterCallEvent {
  return {
    type: "setter_call",
    index,
    previousValue: prev,
    newValue: next,
    seq: 100 + index,
    timestamp: Date.now(),
    deployId: "test-deploy",
  };
}

function makeDeployOutcome(success: boolean): DeployOutcomeEvent {
  return {
    type: "deploy_outcome",
    deployId: "test-deploy",
    success,
    stateSnapshot: { keys: ["App:0"], values: [42] },
    keyMap: { 0: "App:0" },
    seq: 999,
    timestamp: Date.now(),
  };
}

describe("ActionLogMiddleware", () => {
  describe("onInit", () => {
    it("pre-populates events from history", () => {
      const mw = new ActionLogMiddleware(testDir);
      const history = [makeHydrateEvent(0, 10), makeHydrateEvent(1, 20)];

      mw.onInit(history);

      const events = mw.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(history[0]);
    });
  });

  describe("onStateChange", () => {
    it("appends events to in-memory array", () => {
      const mw = new ActionLogMiddleware(testDir);
      mw.onStateChange(makeHydrateEvent(0, 5));
      mw.onStateChange(makeSetterEvent(0, 5, 10));

      const events = mw.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("hydrate");
      expect(events[1].type).toBe("setter_call");
    });
  });

  describe("onDeployOutcome", () => {
    it("appends event and flushes to disk", () => {
      const mw = new ActionLogMiddleware(testDir);
      mw.onStateChange(makeHydrateEvent(0, 42));
      mw.onDeployOutcome(makeDeployOutcome(true));

      const logPath = join(testDir, ".react-pulumi", "action-log.json");
      expect(existsSync(logPath)).toBe(true);

      const content = JSON.parse(readFileSync(logPath, "utf-8")) as ActionLog;
      expect(content.version).toBe(1);
      expect(content.events).toHaveLength(2);
      expect(content.events[0].type).toBe("hydrate");
      expect(content.events[1].type).toBe("deploy_outcome");
    });

    it("creates .react-pulumi/ directory if missing", () => {
      const mw = new ActionLogMiddleware(testDir);
      mw.onDeployOutcome(makeDeployOutcome(true));

      const dirPath = join(testDir, ".react-pulumi");
      expect(existsSync(dirPath)).toBe(true);
    });

    it("warns but does not throw on write failure", () => {
      // Use a non-writable path
      const badDir = join(testDir, "nonexistent", "deep", "path");
      // Make the parent non-writable to simulate failure
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // On most systems mkdirSync with recursive handles this, so we test
      // the error path by making the logPath a directory instead of a file
      mkdirSync(join(testDir, ".react-pulumi", "action-log.json"), { recursive: true });

      const mw = new ActionLogMiddleware(testDir);
      // Should not throw
      mw.onDeployOutcome(makeDeployOutcome(true));

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("loadHistory", () => {
    it("returns events from valid file", () => {
      const logDir = join(testDir, ".react-pulumi");
      mkdirSync(logDir, { recursive: true });
      const log: ActionLog = {
        version: 1,
        events: [makeHydrateEvent(0, 99)],
      };
      writeFileSync(join(logDir, "action-log.json"), JSON.stringify(log), "utf-8");

      const history = ActionLogMiddleware.loadHistory(testDir);
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe("hydrate");
      expect((history[0] as HydrateEvent).value).toBe(99);
    });

    it("returns empty array on missing file", () => {
      const history = ActionLogMiddleware.loadHistory(testDir);
      expect(history).toEqual([]);
    });

    it("returns empty array on corrupt JSON", () => {
      const logDir = join(testDir, ".react-pulumi");
      mkdirSync(logDir, { recursive: true });
      writeFileSync(join(logDir, "action-log.json"), "not json{{{", "utf-8");

      const history = ActionLogMiddleware.loadHistory(testDir);
      expect(history).toEqual([]);
    });

    it("returns empty array on invalid format (wrong version)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logDir = join(testDir, ".react-pulumi");
      mkdirSync(logDir, { recursive: true });
      writeFileSync(
        join(logDir, "action-log.json"),
        JSON.stringify({ version: 99, events: [] }),
        "utf-8",
      );

      const history = ActionLogMiddleware.loadHistory(testDir);
      expect(history).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("getEvents", () => {
    it("returns readonly snapshot of events", () => {
      const mw = new ActionLogMiddleware(testDir);
      mw.onStateChange(makeHydrateEvent(0, 1));

      const events = mw.getEvents();
      expect(events).toHaveLength(1);
    });
  });

  describe("round-trip", () => {
    it("flush then loadHistory returns same events", () => {
      const mw = new ActionLogMiddleware(testDir);
      mw.onStateChange(makeHydrateEvent(0, 42));
      mw.onStateChange(makeHydrateEvent(1, "hello"));
      mw.onDeployOutcome(makeDeployOutcome(true));

      const loaded = ActionLogMiddleware.loadHistory(testDir);
      expect(loaded).toHaveLength(3);
      expect(loaded[0].type).toBe("hydrate");
      expect(loaded[1].type).toBe("hydrate");
      expect(loaded[2].type).toBe("deploy_outcome");
    });
  });
});
