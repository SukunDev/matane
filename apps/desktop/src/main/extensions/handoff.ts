import type { HandoffItem } from '@manga-reader/shared';
import { toAppErrorData } from '@manga-reader/shared/errors';
import type Database from 'better-sqlite3';

export interface HandoffDeps {
  sqlite: Database.Database;
  /**
   * The official repository (null while there is none, or the user removed it); `offers` is null
   * until its index was fetched once.
   */
  official: () => { id: number; offers: ((extensionId: string) => boolean) | null } | null;
  isInstalled: (extensionId: string) => boolean;
  /** Downloads, verifies and installs from a repository without asking (see `ExtensionInstaller`). */
  install: (repoId: number, extensionId: string) => Promise<void>;
  /** Extensions already handed off (or given up on); never installed by themselves again. */
  done: { get(): string[]; set(ids: string[]): void };
  notify: (names: string[]) => void;
  log: (message: string) => void;
  changed: () => void;
}

/**
 * Moves extensions that used to be built into the app to the official repository (Milestones
 * 4e/4f): an extension with manga in the library, whose record is still there (it was never
 * uninstalled), that is no longer loaded and that the official repository offers, is installed by
 * itself once, through the normal verified install, without the permission dialog (it came with
 * the app). Offline it waits; a failed install is shown with a retry and tried again next start.
 */
export class Handoff {
  private items = new Map<string, HandoffItem>();
  private running: Promise<HandoffItem[]> | null = null;

  constructor(private readonly deps: HandoffDeps) {}

  status(): HandoffItem[] {
    return [...this.items.values()];
  }

  run(): Promise<HandoffItem[]> {
    this.running ??= this.pass().finally(() => (this.running = null));
    return this.running;
  }

  /** Extensions in the library that are not installed any more, with their last known name. */
  private candidates(): { id: string; name: string }[] {
    const done = new Set(this.deps.done.get());
    const rows = this.deps.sqlite
      .prepare(
        `SELECT e.id AS id, e.name AS name FROM extensions e
         WHERE EXISTS (
           SELECT 1 FROM sources s JOIN manga m ON m.source_id = s.id
           WHERE s.extension_id = e.id AND m.in_library = 1
         )
         ORDER BY e.name`,
      )
      .all() as { id: string; name: string }[];
    return rows.filter((row) => !done.has(row.id) && !this.deps.isInstalled(row.id));
  }

  private async pass(): Promise<HandoffItem[]> {
    const official = this.deps.official();
    const next = new Map<string, HandoffItem>();
    const installed: string[] = [];
    if (official) {
      for (const { id, name } of this.candidates()) {
        if (!official.offers) {
          next.set(id, { id, name, state: 'waiting', error: null });
          continue;
        }
        // Not offered: nothing to hand off to (it stays "source not installed").
        if (!official.offers(id)) continue;
        try {
          await this.deps.install(official.id, id);
          this.deps.done.set([...this.deps.done.get(), id]);
          installed.push(name);
          this.deps.log(`handoff: installed ${id} from the official repository`);
        } catch (error) {
          const { message } = toAppErrorData(error);
          this.deps.log(`handoff: installing ${id} failed: ${message}`);
          next.set(id, { id, name, state: 'failed', error: message });
        }
      }
    }
    const changed = JSON.stringify([...next.values()]) !== JSON.stringify(this.status());
    this.items = next;
    if (installed.length > 0) this.deps.notify(installed);
    if (changed || installed.length > 0) this.deps.changed();
    return this.status();
  }
}
