import type { DbChangeTag } from '@manga-reader/shared';

/**
 * Collects entity tags touched by repository writes and emits them once per tick as `db.changed`
 * (ADR 0010), so a sync of 500 chapters is one event, not 500.
 */
export class DbChanges {
  private pending = new Set<DbChangeTag>();
  private scheduled = false;

  constructor(private readonly emit: (tags: DbChangeTag[]) => void) {}

  mark(...tags: DbChangeTag[]): void {
    for (const tag of tags) this.pending.add(tag);
    if (this.scheduled || this.pending.size === 0) return;
    this.scheduled = true;
    setImmediate(() => this.flush());
  }

  flush(): void {
    this.scheduled = false;
    if (this.pending.size === 0) return;
    const tags = [...this.pending];
    this.pending = new Set();
    this.emit(tags);
  }
}
