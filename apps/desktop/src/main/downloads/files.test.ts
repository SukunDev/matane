import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMIC_INFO, DownloadReader, pageNames, writeCbz } from './archive';
import { comicInfoXml } from './comicinfo';
import { isInside, movePath, rebase } from './move';
import { chapterBasePath, pageFileName, sanitizeSegment } from './paths';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'matane-dl-files-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sanitizeSegment', () => {
  it('makes names valid on every OS', () => {
    expect(sanitizeSegment('Re:Zero / Ch. 1? "Start" <x>|*')).toBe('Re_Zero _ Ch. 1_ _Start_ _x___');
    expect(sanitizeSegment('Trailing dots... ')).toBe('Trailing dots');
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('nul.txt')).toBe('_nul.txt');
    expect(sanitizeSegment('  ', 'Chapter')).toBe('Chapter');
    expect(sanitizeSegment('???', 'Chapter')).toBe('Chapter');
    expect(sanitizeSegment('tab\tand\nnewline')).toBe('tab and newline');
  });

  it('cuts long names on a character boundary under 120 bytes', () => {
    const cut = sanitizeSegment('影'.repeat(100));
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(120);
    expect(cut).toBe('影'.repeat(40));
  });

  it('builds <folder>/<Source (LANG)>/<Title>/<Chapter [group]>', () => {
    expect(
      chapterBasePath('/dl', {
        sourceName: 'Example Source',
        sourceLang: 'en',
        mangaTitle: 'Kage: Shadow',
        chapterName: 'Ch. 2',
        scanlator: 'Group/A',
      }),
    ).toBe(join('/dl', 'Example Source (EN)', 'Kage_ Shadow', 'Ch. 2 [Group_A]'));
    expect(pageFileName(6, '.jpg')).toBe('007.jpg');
  });
});

describe('comicInfoXml', () => {
  it('writes the known fields, escaped, and leaves empty ones out', () => {
    const xml = comicInfoXml({
      series: 'Tom & Jerry <3',
      title: 'Ch. 1',
      number: 1.5,
      scanlator: null,
      writer: 'A "B"',
      penciller: null,
      genres: ['Action', 'Comedy'],
      summary: null,
      rightToLeft: true,
      web: 'https://example.com/m?a=1&b=2',
      languageIso: 'en',
      pageCount: 20,
    });
    expect(xml).toContain('<Series>Tom &amp; Jerry &lt;3</Series>');
    expect(xml).toContain('<Number>1.5</Number>');
    expect(xml).toContain('<Writer>A &quot;B&quot;</Writer>');
    expect(xml).toContain('<Genre>Action, Comedy</Genre>');
    expect(xml).toContain('<Web>https://example.com/m?a=1&amp;b=2</Web>');
    expect(xml).toContain('<Manga>YesAndRightToLeft</Manga>');
    expect(xml).not.toContain('Translator');
    expect(xml).not.toContain('Summary');
  });
});

describe('archives', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  function chapterFolder() {
    const src = join(dir, 'chapter.tmp');
    mkdirSync(src);
    writeFileSync(join(src, '002.jpg'), JPG);
    writeFileSync(join(src, '010.png'), PNG);
    writeFileSync(join(src, '001.png'), PNG);
    writeFileSync(join(src, COMIC_INFO), '<ComicInfo/>');
    return src;
  }

  it('orders pages by number and skips other files', () => {
    expect(pageNames(['010.png', 'ComicInfo.xml', '002.jpg', '001.png', 'notes.txt'])).toEqual([
      '001.png',
      '002.jpg',
      '010.png',
    ]);
  });

  it('writes a CBZ and reads its pages at random', async () => {
    const target = join(dir, 'chapter.cbz');
    const size = await writeCbz(chapterFolder(), target);
    expect(size).toBeGreaterThan(0);
    const reader = new DownloadReader(1);
    expect(await reader.pages(target, 'cbz')).toEqual(['001.png', '002.jpg', '010.png']);
    expect(await reader.read(target, 'cbz', 1)).toEqual({ bytes: JPG, contentType: 'image/jpeg' });
    expect((await reader.read(target, 'cbz', 2)).contentType).toBe('image/png');
    await expect(reader.read(target, 'cbz', 3)).rejects.toThrow('no page 3');
    await reader.closeAll();
  });

  it('reads a folder download', async () => {
    const src = chapterFolder();
    const reader = new DownloadReader();
    expect(await reader.pages(src, 'folder')).toHaveLength(3);
    expect((await reader.read(src, 'folder', 0)).bytes).toEqual(PNG);
  });
});

describe('moving downloads', () => {
  it('knows what lies inside the download folder and where it goes', () => {
    expect(isInside('/a/Matane', '/a/Matane/S/M/c.cbz')).toBe(true);
    expect(isInside('/a/Matane', '/a/Matane')).toBe(false);
    expect(isInside('/a/Matane', '/a/Matane2/c.cbz')).toBe(false);
    expect(isInside('/a/Matane', '/a/other/c.cbz')).toBe(false);
    expect(rebase('/a/Matane', '/b/New', '/a/Matane/S/M/c.cbz')).toBe(join('/b/New', 'S', 'M', 'c.cbz'));
  });

  it('moves a file into new folders and never overwrites what is there', async () => {
    const from = join(dir, 'a.cbz');
    writeFileSync(from, 'one');
    const target = join(dir, 'x', 'y', 'a.cbz');
    expect(await movePath(from, target)).toBe(target);
    expect(existsSync(from)).toBe(false);

    writeFileSync(from, 'two');
    expect(await movePath(from, target)).toBe(join(dir, 'x', 'y', 'a (2).cbz'));
    expect(readFileSync(target, 'utf8')).toBe('one');
  });
});
