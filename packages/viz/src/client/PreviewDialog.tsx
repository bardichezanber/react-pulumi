/**
 * PreviewDialog — modal overlay showing per-resource preview/deploy results.
 * Follows DESIGN.md: industrial/utilitarian, --surface bg, compact, monospace data.
 *
 * Modes:
 *   preview        — Preview results (read-only, Close button)
 *   deploy-confirm — Preview results with "Confirm Deploy" action
 *   deploying      — Deploying spinner
 *   deploy-result  — Deploy results (success, Close button)
 */

import { useCallback } from "react";

export interface ResourceChange {
  op: "create" | "update" | "delete";
  type: string;
  name: string;
}

export interface PreviewResult {
  create: number;
  update: number;
  delete: number;
  same: number;
  resources?: ResourceChange[];
}

interface PreviewDialogProps {
  result: PreviewResult;
  mode: "preview" | "deploy-confirm" | "deploying" | "deploy-result";
  onClose: () => void;
  onDeploy?: () => void;
}

const opStyles: Record<string, { color: string; symbol: string }> = {
  create: { color: "var(--success)", symbol: "+" },
  update: { color: "var(--warning)", symbol: "~" },
  delete: { color: "var(--error)", symbol: "-" },
};

const titles: Record<string, string> = {
  preview: "Preview Results",
  "deploy-confirm": "Confirm Deploy",
  deploying: "Deploying...",
  "deploy-result": "Deploy Complete",
};

export function PreviewDialog({ result, mode, onClose, onDeploy }: PreviewDialogProps) {
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && mode !== "deploying") onClose();
    },
    [onClose, mode],
  );

  const resources = result.resources ?? [];
  const grouped = {
    create: resources.filter((r) => r.op === "create"),
    update: resources.filter((r) => r.op === "update"),
    delete: resources.filter((r) => r.op === "delete"),
  };

  const hasChanges = result.create > 0 || result.update > 0 || result.delete > 0;

  return (
    <div
      role="presentation"
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: `1px solid ${mode === "deploy-result" ? "var(--success)" : "var(--border)"}`,
          borderRadius: "var(--radius-md, 6px)",
          width: 480,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: "var(--text-base)",
              fontWeight: 600,
              color: mode === "deploy-result" ? "var(--success)" : "var(--text)",
            }}
          >
            {titles[mode]}
          </span>
          {mode !== "deploying" && (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "var(--text-sm)",
                fontFamily: "var(--font-mono)",
                padding: "2px 6px",
              }}
            >
              esc
            </button>
          )}
        </div>

        {/* Deploying state */}
        {mode === "deploying" && (
          <div
            style={{
              padding: "32px 16px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "var(--text-sm)",
            }}
          >
            Running pulumi up...
          </div>
        )}

        {/* Summary bar */}
        {mode !== "deploying" && (
          <div
            style={{
              padding: "8px 16px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 16,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)",
            }}
          >
            {result.create > 0 && (
              <span style={{ color: "var(--success)" }}>+{result.create} create</span>
            )}
            {result.update > 0 && (
              <span style={{ color: "var(--warning)" }}>~{result.update} update</span>
            )}
            {result.delete > 0 && (
              <span style={{ color: "var(--error)" }}>-{result.delete} delete</span>
            )}
            {result.same > 0 && (
              <span style={{ color: "var(--text-dim)" }}>={result.same} same</span>
            )}
            {!hasChanges && <span style={{ color: "var(--text-dim)" }}>no changes</span>}
          </div>
        )}

        {/* Resource list */}
        {mode !== "deploying" && (
          <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
            {(["delete", "update", "create"] as const).map(
              (op) =>
                grouped[op].length > 0 && (
                  <div key={op}>
                    {grouped[op].map((r, i) => (
                      <div
                        key={`${op}-${i}`}
                        style={{
                          padding: "4px 16px",
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                          fontSize: "var(--text-sm)",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: opStyles[op].color,
                            fontWeight: 600,
                            width: 12,
                            flexShrink: 0,
                          }}
                        >
                          {opStyles[op].symbol}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: "var(--text-muted)",
                            fontSize: "var(--text-xs)",
                          }}
                        >
                          {r.type}
                        </span>
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                          {r.name}
                        </span>
                      </div>
                    ))}
                  </div>
                ),
            )}
            {resources.length === 0 && hasChanges && (
              <div
                style={{
                  padding: "12px 16px",
                  color: "var(--text-dim)",
                  fontSize: "var(--text-sm)",
                }}
              >
                Resource details not available.
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {mode !== "deploying" && (
          <div
            style={{
              padding: "8px 16px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                padding: "4px 12px",
                borderRadius: "var(--radius-sm, 4px)",
                border: "1px solid var(--border)",
                background: "var(--surface-raised)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              {mode === "deploy-result" ? "Done" : "Cancel"}
            </button>
            {onDeploy && mode === "deploy-confirm" && hasChanges && (
              <button
                type="button"
                onClick={onDeploy}
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  padding: "4px 12px",
                  borderRadius: "var(--radius-sm, 4px)",
                  border: "1px solid var(--accent)",
                  background: "var(--accent)",
                  color: "#000",
                  cursor: "pointer",
                }}
              >
                Confirm Deploy
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
