import { createHash } from 'node:crypto';
import { open as openFile, readFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { BACKUP_FORMAT_VERSION, type Backup, type BackupChapter, type BackupManga } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';

// Import of Mihon/Tachiyomi backups (`.tachibk`, ADR 0032): gzip around a protobuf `Backup`
// message. Only the fields Matane has a place for are read; everything else is skipped.

const gunzipAsync = promisify(gunzip);
/** A backup file (or its unpacked protobuf) larger than this is not a backup. */
const MAX_BYTES = 512 * 1024 * 1024;

export interface MihonChapter {
  url: string;
  name: string;
  scanlator: string | null;
  read: boolean;
  bookmark: boolean;
  lastPageRead: number;
  dateUpload: number;
  chapterNumber: number;
  sourceOrder: number;
}

export interface MihonHistory {
  url: string;
  lastRead: number;
  readDuration: number;
}

export interface MihonManga {
  /** The source's Long id, as a string (it does not fit a double). */
  source: string;
  url: string;
  title: string;
  artist: string | null;
  author: string | null;
  description: string | null;
  genres: string[];
  status: number;
  thumbnailUrl: string | null;
  dateAdded: number;
  favorite: boolean;
  /** `order` of the categories it is in. */
  categories: number[];
  chapters: MihonChapter[];
  history: MihonHistory[];
}

export interface MihonBackup {
  manga: MihonManga[];
  categories: { name: string; order: number }[];
  /** Source id → name, for the sources the backup names. */
  sources: Map<string, string>;
}

/** A source installed here, the target of a Mihon source. */
export interface InstalledSource {
  id: string;
  extensionId: string;
  key: string;
  name: string;
  lang: string;
}

// ------------------------------------------------------------------ protobuf

interface Field {
  num: number;
  wire: number;
  /** Wire type 0. */
  varint: bigint;
  /** Wire types 1, 2 and 5. */
  bytes: Buffer;
}

const NO_BYTES = Buffer.alloc(0);

function readVarint(buf: Buffer, from: number): { value: bigint; next: number } {
  let value = 0n;
  let shift = 0n;
  let at = from;
  for (;;) {
    if (at >= buf.length || shift > 63n) throw new Error('bad varint');
    const byte = buf[at++]!;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: at };
    shift += 7n;
  }
}

/** The fields of one message, in order. Throws on anything that is not well-formed protobuf. */
function* fields(buf: Buffer): Generator<Field> {
  let at = 0;
  while (at < buf.length) {
    const tag = readVarint(buf, at);
    at = tag.next;
    const num = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (num === 0) throw new Error('bad field number');
    if (wire === 0) {
      const v = readVarint(buf, at);
      at = v.next;
      yield { num, wire, varint: v.value, bytes: NO_BYTES };
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (at + size > buf.length) throw new Error('truncated');
      yield { num, wire, varint: 0n, bytes: buf.subarray(at, at + size) };
      at += size;
    } else if (wire === 2) {
      const length = readVarint(buf, at);
      at = length.next;
      const size = Number(length.value);
      if (size > buf.length - at) throw new Error('truncated');
      yield { num, wire, varint: 0n, bytes: buf.subarray(at, at + size) };
      at += size;
    } else {
      throw new Error('unsupported wire type');
    }
  }
}

const int = (f: Field): number => Number(BigInt.asIntN(64, f.varint));
const text = (f: Field): string => f.bytes.toString('utf8');
const float = (f: Field): number => (f.wire === 5 ? f.bytes.readFloatLE(0) : 0);
/** A repeated varint field, packed or not. */
function* varints(f: Field): Generator<number> {
  if (f.wire === 0) {
    yield int(f);
    return;
  }
  let at = 0;
  while (at < f.bytes.length) {
    const v = readVarint(f.bytes, at);
    at = v.next;
    yield Number(BigInt.asIntN(64, v.value));
  }
}

function decodeChapter(buf: Buffer): MihonChapter {
  const c: MihonChapter = {
    url: '',
    name: '',
    scanlator: null,
    read: false,
    bookmark: false,
    lastPageRead: 0,
    dateUpload: 0,
    chapterNumber: 0,
    sourceOrder: 0,
  };
  for (const f of fields(buf)) {
    if (f.num === 1) c.url = text(f);
    else if (f.num === 2) c.name = text(f);
    else if (f.num === 3) c.scanlator = text(f) || null;
    else if (f.num === 4) c.read = f.varint !== 0n;
    else if (f.num === 5) c.bookmark = f.varint !== 0n;
    else if (f.num === 6) c.lastPageRead = int(f);
    else if (f.num === 8) c.dateUpload = int(f);
    else if (f.num === 9) c.chapterNumber = float(f);
    else if (f.num === 10) c.sourceOrder = int(f);
  }
  return c;
}

function decodeHistory(buf: Buffer): MihonHistory {
  const h: MihonHistory = { url: '', lastRead: 0, readDuration: 0 };
  for (const f of fields(buf)) {
    if (f.num === 1) h.url = text(f);
    else if (f.num === 2) h.lastRead = int(f);
    else if (f.num === 3) h.readDuration = int(f);
  }
  return h;
}

function decodeManga(buf: Buffer): MihonManga {
  const m: MihonManga = {
    source: '0',
    url: '',
    title: '',
    artist: null,
    author: null,
    description: null,
    genres: [],
    status: 0,
    thumbnailUrl: null,
    dateAdded: 0,
    // Mihon does not write default values: a manga without the field is a favourite.
    favorite: true,
    categories: [],
    chapters: [],
    history: [],
  };
  for (const f of fields(buf)) {
    if (f.num === 1) m.source = BigInt.asIntN(64, f.varint).toString();
    else if (f.num === 2) m.url = text(f);
    else if (f.num === 3) m.title = text(f);
    else if (f.num === 4) m.artist = text(f) || null;
    else if (f.num === 5) m.author = text(f) || null;
    else if (f.num === 6) m.description = text(f) || null;
    else if (f.num === 7) m.genres.push(text(f));
    else if (f.num === 8) m.status = int(f);
    else if (f.num === 9) m.thumbnailUrl = text(f) || null;
    else if (f.num === 13) m.dateAdded = int(f);
    else if (f.num === 16) m.chapters.push(decodeChapter(f.bytes));
    else if (f.num === 17) m.categories.push(...varints(f));
    else if (f.num === 100) m.favorite = f.varint !== 0n;
    else if (f.num === 104) m.history.push(decodeHistory(f.bytes));
  }
  return m;
}

/** Decodes the protobuf `Backup` message of a Mihon/Tachiyomi backup. */
export function decodeMihon(buf: Buffer): MihonBackup {
  const backup: MihonBackup = { manga: [], categories: [], sources: new Map() };
  for (const f of fields(buf)) {
    if (f.wire !== 2) continue;
    if (f.num === 1) backup.manga.push(decodeManga(f.bytes));
    else if (f.num === 2) {
      let name = '';
      let order = 0;
      for (const g of fields(f.bytes)) {
        if (g.num === 1) name = text(g);
        else if (g.num === 2) order = int(g);
      }
      if (name) backup.categories.push({ name, order });
    } else if (f.num === 100 || f.num === 101) {
      // 100 is the older layout of the same message (a source that was not installed).
      let name = '';
      let id = '';
      for (const g of fields(f.bytes)) {
        if (g.num === 1) name = text(g);
        else if (g.num === 2) id = BigInt.asIntN(64, g.varint).toString();
      }
      if (id && name) backup.sources.set(id, name);
    }
  }
  return backup;
}

// ------------------------------------------------------------------ file

/** Whether a file is a Mihon/Tachiyomi backup: anything that is not a zip (Matane's own format). */
export async function isMihonFile(path: string): Promise<boolean> {
  const file = await openFile(path, 'r').catch(() => {
    throw new AppError('parse', 'This file cannot be read');
  });
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await file.read(head, 0, 4, 0);
    return !(bytesRead >= 2 && head[0] === 0x50 && head[1] === 0x4b);
  } finally {
    await file.close();
  }
}

/** Reads and decodes a `.tachibk` (gzip) file; an unpacked protobuf file is accepted too. */
export async function readMihonFile(path: string): Promise<MihonBackup> {
  const raw = await readFile(path);
  if (raw.length > MAX_BYTES) throw new AppError('parse', 'This file is too large to be a backup');
  let data = raw;
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      data = await gunzipAsync(raw, { maxOutputLength: MAX_BYTES });
    } catch {
      throw new AppError('parse', 'The Mihon backup is damaged (it cannot be unpacked)');
    }
  }
  let backup: MihonBackup;
  try {
    backup = decodeMihon(data);
  } catch {
    throw new AppError('parse', 'This file is not a Matane or Mihon backup');
  }
  if (backup.manga.length === 0 && backup.categories.length === 0) {
    throw new AppError('parse', 'This file is not a Matane or Mihon backup (it holds no library)');
  }
  return backup;
}

// ------------------------------------------------------------------ sources

/**
 * The id Mihon gives a source: the first 8 bytes of MD5("<name in lower case>/<lang>/<version>")
 * as a positive Long. A port of an extension that keeps name and language gets the same id.
 */
export function mihonSourceId(name: string, lang: string, versionId = 1): string {
  const digest = createHash('md5').update(`${name.toLowerCase()}/${lang}/${versionId}`).digest();
  return (digest.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString();
}

/** Version ids tried when computing ids (extensions bump it when a site changes completely). */
const VERSION_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Which installed source each Mihon source goes to when nothing is chosen: the one whose
 * computed Mihon id is the same, else the only one with the same name (any case).
 */
export function matchSources(
  mihonSources: { id: string; name: string | null }[],
  installed: InstalledSource[],
): Map<string, string | null> {
  const byId = new Map<string, string>();
  for (const source of installed) {
    const langs = source.lang === 'multi' || source.lang === 'mul' ? [source.lang, 'all'] : [source.lang];
    for (const lang of langs) {
      for (const version of VERSION_IDS) {
        const id = mihonSourceId(source.name, lang, version);
        if (!byId.has(id)) byId.set(id, source.id);
      }
    }
  }
  const matches = new Map<string, string | null>();
  for (const { id, name } of mihonSources) {
    let found = byId.get(id) ?? null;
    if (!found && name) {
      const same = installed.filter((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (same.length === 1) found = same[0]!.id;
    }
    matches.set(id, found);
  }
  return matches;
}

/** An extension a repository offers that is not installed here. */
export interface OfferedExtension {
  repoId: number;
  id: string;
  name: string;
  langs: string[];
}

/**
 * For Mihon sources nothing installed matches: the extension in the repositories that is probably
 * it. A source of an extension has the extension's name (ports keep the site's name), so the same
 * rules apply as for installed sources: the computed Mihon id for the extension's name and each of
 * its languages, else a name (any case, without a "Tachiyomi: " prefix) that only one offers.
 */
export function matchOffers(
  mihonSources: { id: string; name: string | null }[],
  offered: OfferedExtension[],
): Map<string, OfferedExtension | null> {
  const plain = (name: string) =>
    name
      .replace(/^tachiyomi:\s*/i, '')
      .trim()
      .toLowerCase();
  const byId = new Map<string, OfferedExtension>();
  for (const extension of offered) {
    for (const lang of new Set([...extension.langs, 'all'])) {
      for (const version of VERSION_IDS) {
        const id = mihonSourceId(plain(extension.name), lang, version);
        if (!byId.has(id)) byId.set(id, extension);
      }
    }
  }
  const matches = new Map<string, OfferedExtension | null>();
  for (const { id, name } of mihonSources) {
    let found = byId.get(id) ?? null;
    if (!found && name) {
      const same = offered.filter((e) => plain(e.name) === name.trim().toLowerCase());
      if (new Set(same.map((e) => e.id)).size === 1) found = same[0]!;
    }
    matches.set(id, found);
  }
  return matches;
}

/** The sources a backup's manga use, with their names (when the backup names them) and counts. */
export function listMihonSources(
  mihon: MihonBackup,
): { id: string; name: string | null; manga: number; inLibrary: number }[] {
  const used = new Map<string, { id: string; name: string | null; manga: number; inLibrary: number }>();
  for (const manga of mihon.manga) {
    const entry = used.get(manga.source) ?? {
      id: manga.source,
      name: mihon.sources.get(manga.source) ?? null,
      manga: 0,
      inLibrary: 0,
    };
    entry.manga++;
    if (manga.favorite) entry.inLibrary++;
    used.set(manga.source, entry);
  }
  return [...used.values()].sort((a, b) => b.manga - a.manga || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ conversion

/** SManga status → Matane's: licensed and unknown have no counterpart. */
function statusOf(status: number): string {
  if (status === 1) return 'ongoing';
  if (status === 2 || status === 4) return 'completed';
  if (status === 5) return 'cancelled';
  if (status === 6) return 'hiatus';
  return 'unknown';
}

const time = (ms: number): number | null => (ms > 0 ? ms : null);
/** Floats come as 32 bit: 8.1 reads back as 8.100000381. */
const round = (n: number): number => Math.round(n * 1000) / 1000;

function convertManga(manga: MihonManga, target: string, categoryNames: Map<number, string>): BackupManga {
  const chapters: BackupChapter[] = [];
  const seen = new Set<string>();
  const historyOf = new Map(manga.history.filter((h) => h.url).map((h) => [h.url, h]));
  const lastReadHere = manga.history.reduce((latest, h) => Math.max(latest, h.lastRead), 0);
  for (const chapter of manga.chapters) {
    if (!chapter.url || seen.has(chapter.url)) continue;
    seen.add(chapter.url);
    chapters.push({
      url: chapter.url,
      name: chapter.name,
      number: chapter.chapterNumber < 0 ? null : round(chapter.chapterNumber),
      scanlator: chapter.scanlator,
      uploadedAt: time(chapter.dateUpload),
      sourceOrder: chapter.sourceOrder,
      read: chapter.read,
      // Mihon keeps no time for "read", only history: that of the chapter, else the latest here.
      readAt: chapter.read ? (time(historyOf.get(chapter.url)?.lastRead ?? 0) ?? time(lastReadHere)) : null,
      bookmarked: chapter.bookmark,
      lastPage: Math.max(0, chapter.lastPageRead),
      totalPages: null,
      pageOffset: null,
      download: null,
    });
  }
  const known = new Set(chapters.map((c) => c.url));
  const history = manga.history.filter((h) => known.has(h.url) && h.lastRead > 0);
  const latest = history.reduce<MihonHistory | null>(
    (best, h) => (!best || h.lastRead > best.lastRead ? h : best),
    null,
  );
  return {
    sourceId: target,
    url: manga.url,
    title: manga.title || manga.url,
    author: manga.author,
    artist: manga.artist,
    description: manga.description,
    genres: manga.genres,
    status: statusOf(manga.status),
    type: null,
    thumbnailUrl: manga.thumbnailUrl,
    inLibrary: manga.favorite,
    addedAt: time(manga.dateAdded),
    latestChapterAt: chapters.reduce<number | null>(
      (max, c) => (c.uploadedAt && c.uploadedAt > (max ?? 0) ? c.uploadedAt : max),
      null,
    ),
    readerSettings: null,
    scanlatorPrefs: null,
    chapterView: null,
    categories: manga.categories.map((order) => categoryNames.get(order)).filter((name): name is string => !!name),
    customCover: null,
    chapters,
    history: latest ? { chapterUrl: latest.url, readAt: latest.lastRead } : null,
    // The time Mihon counted for a chapter becomes one reading session ending when it was last read.
    sessions: history
      .filter((h) => h.readDuration > 0)
      .map((h) => ({
        chapterUrl: h.url,
        startedAt: Math.max(0, h.lastRead - h.readDuration),
        endedAt: h.lastRead,
        activeMs: h.readDuration,
      })),
    tracks: [],
  };
}

/**
 * A Mihon backup as a Matane one. `sourceMap` says which installed source each Mihon source id
 * goes to; manga of a source without a target are left out and counted in `unmatched`.
 */
export function convertMihon(
  mihon: MihonBackup,
  sourceMap: Map<string, string | null>,
  installed: InstalledSource[],
  createdAt: number,
): { backup: Backup; unmatched: { name: string | null; manga: number }[] } {
  const categoryNames = new Map(mihon.categories.map((c) => [c.order, c.name]));
  const byId = new Map(installed.map((s) => [s.id, s]));
  const used = new Set<string>();
  const unmatched = new Map<string, { name: string | null; manga: number }>();
  const manga: BackupManga[] = [];
  for (const entry of mihon.manga) {
    const target = sourceMap.get(entry.source);
    if (!target || !byId.has(target)) {
      const skipped = unmatched.get(entry.source) ?? { name: mihon.sources.get(entry.source) ?? null, manga: 0 };
      skipped.manga++;
      unmatched.set(entry.source, skipped);
      continue;
    }
    used.add(target);
    manga.push(convertManga(entry, target, categoryNames));
  }
  return {
    backup: {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: 'Mihon',
      createdAt,
      data: {
        sources: [...used].map((id) => {
          const s = byId.get(id)!;
          return {
            id: s.id,
            extensionId: s.extensionId,
            key: s.key,
            name: s.name,
            lang: s.lang,
            pinned: false,
            lastUsedAt: null,
          };
        }),
        categories: [...mihon.categories]
          .sort((a, b) => a.order - b.order)
          .map((c) => ({ name: c.name, sortOrder: c.order, settings: null })),
        manga,
        repos: [],
        extensions: [],
        settings: {},
      },
    },
    unmatched: [...unmatched.values()].sort((a, b) => b.manga - a.manga),
  };
}
