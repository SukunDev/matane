import sharp from 'sharp';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Characters no file system takes, and control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]+/g;

/** "Title - Ch. 12 - p 3.jpg" for "Save image…" in the reader. */
export function pageFileName(title: string, chapter: string, index: number, contentType: string | null): string {
  const clean = (text: string) => text.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const extension = (contentType && EXTENSIONS[contentType.split(';')[0]!.trim().toLowerCase()]) ?? 'png';
  return `${[clean(title), clean(chapter), `p ${index + 1}`].filter(Boolean).join(' - ')}.${extension}`;
}

/** The clipboard only takes PNG and JPEG; everything goes as PNG. */
export function toPng(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes, { failOn: 'none' }).rotate().png().toBuffer();
}
