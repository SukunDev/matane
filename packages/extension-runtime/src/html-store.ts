import { type Cheerio, type CheerioAPI, type contains, load } from 'cheerio';

type AnyNode = Parameters<typeof contains>[0];
type Selection = Cheerio<AnyNode>;

interface Entry {
  $: CheerioAPI;
  selection: Selection;
  baseUrl: string | undefined;
}

/**
 * Keeps parsed documents on the host side; the sandbox only ever sees numeric handles
 * (parsing big HTML inside QuickJS would be far too slow — BRAINSTORM.md §5.5).
 */
export class HtmlStore {
  private entries = new Map<number, Entry>();
  private nextId = 1;

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  load(body: string, options: { baseUrl?: string; xml?: boolean }): number {
    const $ = load(body, { xml: options.xml ?? false });
    return this.add({ $, selection: $.root(), baseUrl: options.baseUrl });
  }

  select(id: number, selector: string): number[] {
    const entry = this.get(id);
    return entry.selection
      .find(selector)
      .toArray()
      .map((node) => this.add({ ...entry, selection: entry.$(node) }));
  }

  selectFirst(id: number, selector: string): number | null {
    const entry = this.get(id);
    const first = entry.selection.find(selector).first();
    return first.length === 0 ? null : this.add({ ...entry, selection: first });
  }

  text(id: number): string {
    return this.get(id).selection.text().trim();
  }

  html(id: number): string {
    return this.get(id).selection.html() ?? '';
  }

  attr(id: number, name: string): string | null {
    return this.get(id).selection.attr(name) ?? null;
  }

  absUrl(id: number, name: string): string | null {
    const entry = this.get(id);
    const value = entry.selection.attr(name);
    if (value === undefined) return null;
    try {
      return new URL(value, entry.baseUrl).toString();
    } catch {
      return null;
    }
  }

  private add(entry: Entry): number {
    const id = this.nextId++;
    this.entries.set(id, entry);
    return id;
  }

  private get(id: number): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Stale HTML handle ${id}; handles only live for the duration of one call`);
    return entry;
  }
}
