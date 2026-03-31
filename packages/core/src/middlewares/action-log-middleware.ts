/**
 * ActionLogMiddleware — records state change events in memory and
 * persists them to `.react-pulumi/action-log.json` on deploy outcome.
 *
 * This enables time-travel across deployments: each deploy's hydrate
 * events form a snapshot, and the full log captures the history.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type {
  ActionLogEntry,
  DeployOutcomeEvent,
  StateChangeEvent,
  StateMiddleware,
} from "../state-middleware.js";

export interface ActionLog {
  version: 1;
  events: ActionLogEntry[];
}

const ACTION_LOG_FILENAME = ".react-pulumi/action-log.json";

export class ActionLogMiddleware implements StateMiddleware {
  private events: ActionLogEntry[] = [];
  private readonly logPath: string;

  constructor(projectDir?: string) {
    this.logPath = join(projectDir ?? process.cwd(), ACTION_LOG_FILENAME);
  }

  onInit(history: ActionLogEntry[]): void {
    this.events = [...history];
  }

  onStateChange(event: StateChangeEvent): void {
    this.events.push(event);
  }

  onDeployOutcome(event: DeployOutcomeEvent): void {
    this.events.push(event);
    this.flush();
  }

  getEvents(): readonly ActionLogEntry[] {
    return this.events;
  }

  private flush(): void {
    try {
      const log: ActionLog = { version: 1, events: this.events };
      const dir = dirname(this.logPath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.logPath, JSON.stringify(log, null, 2), "utf-8");
    } catch (err) {
      console.warn("[react-pulumi] Failed to write action log:", err);
    }
  }

  static loadHistory(projectDir?: string): ActionLogEntry[] {
    const logPath = join(projectDir ?? process.cwd(), ACTION_LOG_FILENAME);
    try {
      const raw = readFileSync(logPath, "utf-8");
      const parsed = JSON.parse(raw) as ActionLog;
      if (parsed.version === 1 && Array.isArray(parsed.events)) {
        return parsed.events;
      }
      console.warn("[react-pulumi] Invalid action log format, starting fresh.");
      return [];
    } catch {
      // File missing or unreadable — start fresh (expected on first run)
      return [];
    }
  }
}
