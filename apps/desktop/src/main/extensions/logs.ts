import type { ExtensionLogEntry } from '@manga-reader/shared';

export const LOG_LINES_KEPT = 500;
const MAX_MESSAGE = 2000;

/**
 * The last lines each extension logged (docs/BRAINSTORM.md §5.9 developer panel): its own `log.*`,
 * failed calls and HTTP traffic. Kept in memory only; new lines are pushed to the renderer live.
 */
export class ExtensionLogs {
  private readonly lines = new Map<string, ExtensionLogEntry[]>();
  private seq = 0;

  constructor(
    private readonly onLine: (extensionId: string, entry: ExtensionLogEntry) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  append(
    extensionId: string,
    level: ExtensionLogEntry['level'],
    kind: ExtensionLogEntry['kind'],
    message: string,
  ): void {
    const entry: ExtensionLogEntry = {
      seq: ++this.seq,
      at: this.now(),
      level,
      kind,
      message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message,
    };
    const list = this.lines.get(extensionId) ?? [];
    list.push(entry);
    if (list.length > LOG_LINES_KEPT) list.splice(0, list.length - LOG_LINES_KEPT);
    this.lines.set(extensionId, list);
    this.onLine(extensionId, entry);
  }

  list(extensionId: string): ExtensionLogEntry[] {
    return [...(this.lines.get(extensionId) ?? [])];
  }

  clear(extensionId: string): void {
    this.lines.delete(extensionId);
  }
}
