/**
 * E2E tests for the viz server REST API + WebSocket integration.
 * Starts a real HTTP server, tests endpoints, and verifies WebSocket messages.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVizServer, type VizServer } from "../server.js";

let testDir: string;
let server: VizServer;
let cwdSpy: ReturnType<typeof vi.spyOn>;

// Minimal mock tree
const mockTree = {
  type: "__root__",
  children: [],
  meta: { typeToken: "__root__", name: "root", props: {} },
} as any;

beforeEach(() => {
  testDir = join(tmpdir(), `viz-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(testDir);
});

afterEach(async () => {
  server?.close();
  cwdSpy.mockRestore();
  rmSync(testDir, { recursive: true, force: true });
});

async function fetch_(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}${path}`, init);
}

describe("E2E: viz server REST API", () => {
  it("GET /api/tree returns tree and status", async () => {
    server = await startVizServer({ port: 0, tree: mockTree });

    const res = await fetch_("/api/tree");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tree).toBeDefined();
    expect(data.status).toBe("idle");
  });

  it("GET /api/history returns empty history on first run", async () => {
    server = await startVizServer({ port: 0, tree: mockTree, projectDir: testDir });

    const res = await fetch_("/api/history");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.history).toEqual([]);
  });

  it("GET /api/history returns deploy outcomes from action log", async () => {
    // Write a fake action log
    const logDir = join(testDir, ".react-pulumi");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      join(logDir, "action-log.json"),
      JSON.stringify({
        version: 1,
        events: [
          {
            type: "deploy_outcome",
            deployId: "d1",
            success: true,
            timestamp: 1000,
            stateSnapshot: { keys: ["App:0"], values: [1] },
            keyMap: { 0: "App:0" },
            seq: 0,
          },
        ],
      }),
    );

    server = await startVizServer({ port: 0, tree: mockTree, projectDir: testDir });

    const res = await fetch_("/api/history");
    const data = await res.json();
    expect(data.history).toHaveLength(1);
    expect(data.history[0].deployId).toBe("d1");
    expect(data.history[0].success).toBe(true);
  });

  it("GET /api/viz-controls returns initial controls from CLI", async () => {
    const initialControls = [
      { name: "replicas", controlType: "input" as const, inputType: "number" as const, value: 2 },
      { name: "scale-up", controlType: "button" as const, label: "Scale Up" },
    ];

    server = await startVizServer({ port: 0, tree: mockTree, initialControls });

    const res = await fetch_("/api/viz-controls");
    const data = await res.json();
    expect(data.controls).toHaveLength(2);
    expect(data.controls.find((c: any) => c.name === "replicas").controlType).toBe("input");
    expect(data.controls.find((c: any) => c.name === "scale-up").controlType).toBe("button");
  });

  it("POST /api/viz-controls/:name invokes via onInvoke callback", async () => {
    const onInvokeFn = vi.fn();
    const initialControls = [{ name: "action", controlType: "button" as const, label: "Action" }];

    server = await startVizServer({ port: 0, tree: mockTree, initialControls });
    server.onInvoke = onInvokeFn;

    const res = await fetch_("/api/viz-controls/action", { method: "POST" });
    expect(res.status).toBe(200);
    expect(onInvokeFn).toHaveBeenCalledWith("action", undefined);
  });

  it("POST /api/viz-controls/:name passes value to onInvoke for input controls", async () => {
    const onInvokeFn = vi.fn();
    const initialControls = [{ name: "count", controlType: "input" as const, value: 1 }];

    server = await startVizServer({ port: 0, tree: mockTree, initialControls });
    server.onInvoke = onInvokeFn;

    const res = await fetch_("/api/viz-controls/count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: 5 }),
    });
    expect(res.status).toBe(200);
    expect(onInvokeFn).toHaveBeenCalledWith("count", 5);
  });

  it("POST /api/viz-controls/:name records correct state diff across multiple actions", async () => {
    let currentReplicas = 2;
    const initialControls = [
      { name: "replicas", controlType: "input" as const, inputType: "number" as const, value: 2 },
    ];

    server = await startVizServer({ port: 0, tree: mockTree, initialControls });

    // onInvoke simulates the CLI calling vizRegistry.invoke (updates state)
    server.onInvoke = async () => {
      currentReplicas++;
    };
    // onRerender simulates CLI re-render returning updated controls
    server.onRerender = async () => ({
      controls: [
        { name: "replicas", controlType: "input", inputType: "number", value: currentReplicas },
      ],
    });

    // First action: replicas 2 → 3
    const res1 = await fetch_("/api/viz-controls/replicas", { method: "POST" });
    const data1 = await res1.json();
    expect(data1.ok).toBe(true);

    // Second action: replicas 3 → 4
    const res2 = await fetch_("/api/viz-controls/replicas", { method: "POST" });
    const data2 = await res2.json();
    expect(data2.ok).toBe(true);

    // Verify action log has correct diffs
    const actionsRes = await fetch_("/api/actions");
    const actionsData = await actionsRes.json();
    expect(actionsData.actions).toHaveLength(2);

    // First action: 2 → 3
    expect(actionsData.actions[0].stateBefore).toEqual({ replicas: 2 });
    expect(actionsData.actions[0].stateAfter).toEqual({ replicas: 3 });

    // Second action: 3 → 4 (this was the bug — previously showed "no change")
    expect(actionsData.actions[1].stateBefore).toEqual({ replicas: 3 });
    expect(actionsData.actions[1].stateAfter).toEqual({ replicas: 4 });
  });

  it("POST /api/deploy returns 501 when no handler configured", async () => {
    server = await startVizServer({ port: 0, tree: mockTree });

    const res = await fetch_("/api/deploy", { method: "POST" });
    expect(res.status).toBe(501);
  });

  it("POST /api/deploy returns 409 when busy", async () => {
    server = await startVizServer({ port: 0, tree: mockTree });

    // Set up a slow handler
    let resolveHandler: () => void;
    const handlerPromise = new Promise<void>((r) => {
      resolveHandler = r;
    });
    server.onDeploy = () => handlerPromise;

    // First deploy starts
    const res1Promise = fetch_("/api/deploy", { method: "POST" });
    await new Promise((r) => setTimeout(r, 50)); // let it start

    // Second deploy should be rejected
    const res2 = await fetch_("/api/deploy", { method: "POST" });
    expect(res2.status).toBe(409);

    // Clean up
    resolveHandler!();
    await res1Promise;
  });

  // WebSocket broadcast is covered by ws-server.test.ts
  // startVizServer's WS integration is tested via the ws-server module directly
});
