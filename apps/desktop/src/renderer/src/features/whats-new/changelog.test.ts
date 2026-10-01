import { describe, expect, it } from 'vitest';
import changelog from '../../../../../../../CHANGELOG.md?raw';
import { inline, releaseNotes } from './changelog';

const MD = `# Changelog

Intro.

## 1.1.0 — unreleased

Later.

## 1.0.0 — 2026-11-01

The first stable release, with
a wrapped paragraph.

### Reader

- Crop borders and **split** tall pages.
- Keys: \`Ctrl+K\` opens the palette,
  and the item wraps.

## 0.9.0 — 2026-10-01

- Old.
`;

describe('releaseNotes', () => {
  it('finds the section of a version and stops at the next one', () => {
    const notes = releaseNotes(MD, '1.0.0')!;
    expect(notes.date).toBe('2026-11-01');
    expect(notes.blocks).toEqual([
      { kind: 'paragraph', text: 'The first stable release, with a wrapped paragraph.' },
      { kind: 'heading', text: 'Reader' },
      { kind: 'item', text: 'Crop borders and **split** tall pages.' },
      { kind: 'item', text: 'Keys: `Ctrl+K` opens the palette, and the item wraps.' },
    ]);
  });

  it('has nothing for a version without a section', () => {
    expect(releaseNotes(MD, '2.0.0')).toBeNull();
    expect(releaseNotes(MD, '1.1.0')?.blocks).toEqual([{ kind: 'paragraph', text: 'Later.' }]);
  });

  it('reads the bundled changelog', () => {
    const notes = releaseNotes(changelog, '0.1.0-beta.1')!;
    expect(notes.date).toBe('2026-09-27');
    expect(notes.blocks.some((b) => b.kind === 'heading')).toBe(true);
  });
});

describe('inline', () => {
  it('splits code and bold from text', () => {
    expect(inline('Use `mr-ext` and **sign** it.')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: 'mr-ext' },
      { kind: 'text', text: ' and ' },
      { kind: 'strong', text: 'sign' },
      { kind: 'text', text: ' it.' },
    ]);
    expect(inline('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
  });
});
