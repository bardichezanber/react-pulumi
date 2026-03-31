/**
 * ControlPanel — top bar per DESIGN.md spec.
 * 40px height, --surface bg, WS indicator + status + Deploy/Preview buttons.
 */

import { useCallback, useState } from "react";
import { useInfraStore } from "../infra-store.js";

export function ControlPanel() {
  const status = useInfraStore((s) => s.deploymentStatus);
  const wsConnected = useInfraStore((s) => s.wsConnected);
  const actions = useInfraStore((s) => s.actions);
  const [error, setError] = useState<string | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);

  const isOperating = status === "deploying" || status === "previewing";

  // Count state keys that differ from the initial state (first action's stateBefore).
  // This represents actual pending changes, not total action count.
  // e.g. scale-up then scale-down = 0 pending changes (state returned to initial).
  let pendingCount = 0;
  if (actions.length > 0) {
    const initial = actions[0].stateBefore; // oldest action's before = initial state
    const current = actions[actions.length - 1].stateAfter; // newest action's after = current state
    const allKeys = new Set([...Object.keys(initial), ...Object.keys(current)]);
    for (const k of allKeys) {
      if (initial[k] !== current[k]) pendingCount++;
    }
  }

  const handleDeploy = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/deploy", { method: "POST" });
    if (res.status === 409) setError("Operation in progress");
    else if (!res.ok) setError(`Deploy failed: ${res.statusText}`);
    else {
      setSuccessFlash(true);
      setTimeout(() => setSuccessFlash(false), 3000);
    }
  }, []);

  const handlePreview = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/preview", { method: "POST" });
    if (!res.ok) setError(`Preview failed: ${res.statusText}`);
  }, []);

  return (
    <div style={{
      height: 40, padding: "0 var(--space-lg)", borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "center", gap: "var(--space-md)", background: "var(--surface)",
      fontFamily: "var(--font-sans)",
    }}>
      {/* WS indicator */}
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: wsConnected ? "var(--success)" : "var(--error)",
        boxShadow: wsConnected ? "0 0 6px var(--success)" : "0 0 6px var(--error)",
      }} />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
        {wsConnected ? "Connected" : "Reconnecting..."}
      </span>

      {/* Deploy button */}
      <button
        onClick={handleDeploy}
        disabled={isOperating}
        style={{
          fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", fontWeight: 600,
          padding: "4px 12px", borderRadius: "var(--radius-sm)",
          border: "1px solid var(--accent)", background: "var(--accent)", color: "#000",
          cursor: isOperating ? "not-allowed" : "pointer", opacity: isOperating ? 0.5 : 1,
        }}
      >
        {isOperating ? "Deploying..." : pendingCount > 0 ? `Deploy (${pendingCount} ${pendingCount === 1 ? "change" : "changes"})` : "Deploy"}
      </button>

      {/* Preview button */}
      <button
        onClick={handlePreview}
        disabled={isOperating}
        style={{
          fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", fontWeight: 500,
          padding: "4px 12px", borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)", background: "var(--surface-raised)", color: "var(--text)",
          cursor: isOperating ? "not-allowed" : "pointer", opacity: isOperating ? 0.5 : 1,
        }}
      >
        Preview
      </button>

      {/* Status */}
      <span style={{
        marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
        color: successFlash ? "var(--success)" : "var(--text-dim)",
        transition: "color 0.15s",
      }}>
        {successFlash ? "Deployed ✓" : error ? error : `status: ${status}`}
      </span>
    </div>
  );
}
