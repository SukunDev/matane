// What's new (docs/BRAINSTORM.md §6.6): the release notes come from CHANGELOG.md, bundled with the app so
// they show offline. Sections are `## <version> — <date>` (the same format release.yml reads).

export type Block = { kind: 'paragraph' | 'heading' | 'item'; text: string };
export type Inline = { kind: 'text' | 'code' | 'strong'; text: string } | { kind: 'link'; text: string; href: string };

export interface ReleaseNotes {
  version: string;
  date: string;
  blocks: Block[];
}

const SECTION = /^## (\S+) — (.+)$/;

/** The notes of one version, or null when the changelog has no section for it. */
export function releaseNotes(markdown: string, version: string): ReleaseNotes | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => SECTION.exec(line)?.[1] === version);
  if (start < 0) return null;
  const date = SECTION.exec(lines[start]!)![2]!;
  const blocks: Block[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('### ')) blocks.push({ kind: 'heading', text: trimmed.slice(4) });
    else if (/^[-*] /.test(trimmed)) blocks.push({ kind: 'item', text: trimmed.slice(2) });
    else {
      // A wrapped line continues the paragraph or item before it.
      const last = blocks.at(-1);
      if (last && last.kind !== 'heading' && line.startsWith(' ')) last.text += ` ${trimmed}`;
      else if (last?.kind === 'paragraph') last.text += ` ${trimmed}`;
      else blocks.push({ kind: 'paragraph', text: trimmed });
    }
  }
  return { version, date, blocks };
}

/** `code`, **bold** and [links](https://…) inside a line; everything else is plain text. */
export function inline(text: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) parts.push({ kind: 'text', text: text.slice(at, match.index) });
    if (match[1] !== undefined) parts.push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined) parts.push({ kind: 'strong', text: match[2] });
    else parts.push({ kind: 'link', text: match[3]!, href: match[4]! });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}
