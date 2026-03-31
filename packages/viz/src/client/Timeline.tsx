/**
 * Timeline — Action/State History per DESIGN.md.
 *
 * Shows user-initiated actions (VizButton clicks, VizInput edits)
 * with state diffs. NOT raw middleware events.
 */

import { useEffect } from "react";
import type { VizActionEntry } from "@react-pulumi/core";
import { useInfraStore } from "../infra-store.js";

export function Timeline() {
  const actions = useInfraStore((s) => s.actions);
  const setActions = useInfraStore((s) => s.setActions);

  // Fetch action log on mount
  useEffect(() => {
    fetch("/api/actions")
      .then((r) => r.json())
      .then((data: { actions: VizActionEntry[] }) => setActions(data.actions))
      .catch(() => {});
  }, [setActions]);

  // Compute state diffs for each action
  const displayEntries = actions.map((action) => {
    const diffs: Array<{ key: string; before: unknown; after: unknown; changed: boolean }> = [];
    const allKeys = new Set([...Object.keys(action.stateBefore), ...Object.keys(action.stateAfter)]);
    for (const key of allKeys) {
      const before = action.stateBefore[key];
      const after = action.stateAfter[key];
      diffs.push({ key, before, after, changed: before !== after });
    }
    return { ...action, diffs };
  });

  // Newest first
  const reversed = [...displayEntries].reverse();

  return (
    <div style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-base)" }}>
      <div style={{
        padding: "var(--space-md) var(--space-lg) var(--space-sm)",
        fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase" as const,
        letterSpacing: "0.08em", color: "var(--text-dim)", borderBottom: "1px solid var(--border)",
      }}>
        Action / State History
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {reversed.length === 0 && (
          <div style={{ padding: "var(--space-xl) var(--space-lg)", color: "var(--text-dim)", fontSize: "var(--text-sm)" }}>
            No actions yet. Edit a VizInput or click a VizButton to see state changes here.
          </div>
        )}

        {reversed.map((entry, i) => (
          <div key={`action-${i}`} style={{
            padding: "var(--space-sm) var(--space-lg)",
            borderBottom: "1px solid var(--border)",
            borderLeft: "2px solid var(--accent)",
          }}>
            {/* Header: trigger name + timestamp */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  display: "inline-block", width: 5, height: 5, borderRadius: "50%",
                  background: "var(--accent)",
                }} />
                {entry.trigger}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
            </div>

            {/* State diffs */}
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", marginTop: 3 }}>
              {entry.diffs.map((diff) => (
                <div key={diff.key} style={{ color: diff.changed ? "var(--text)" : "var(--text-dim)" }}>
                  {diff.key}: {diff.changed
                    ? <>{JSON.stringify(diff.before)} <span style={{ color: "var(--accent)" }}>→</span> {JSON.stringify(diff.after)}</>
                    : JSON.stringify(diff.after)
                  }
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
