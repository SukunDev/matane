// Reader option lists, zod-free so the renderer can import them without the schemas.
export const READER_MODES = ['auto', 'single', 'double', 'webtoon', 'vertical'] as const;
export const READER_DIRECTIONS = ['auto', 'ltr', 'rtl'] as const;
export const READER_FITS = ['width', 'height', 'screen', 'original'] as const;
export const TAP_ZONES = ['l', 'kindle', 'edges', 'lr', 'off'] as const;
export const READER_BACKGROUNDS = ['black', 'gray', 'white'] as const;
