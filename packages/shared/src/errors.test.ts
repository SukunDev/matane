import { describe, expect, it } from 'vitest';
import { AppError, codeForExtensionError, decodeIpcError, encodeIpcError, toAppErrorData } from './errors';

describe('app errors', () => {
  it('round-trip through the Electron invoke message', () => {
    const encoded = encodeIpcError(new AppError('http', 'HTTP 503 for https://x', 503));
    // What the renderer actually receives from ipcRenderer.invoke:
    const received = new Error(`Error invoking remote method 'sources.browse': Error: ${encoded.message}`);
    expect(decodeIpcError(received)).toEqual({ code: 'http', message: 'HTTP 503 for https://x', status: 503 });
  });

  it('degrades unknown errors to code "unknown"', () => {
    expect(decodeIpcError(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom' });
    expect(toAppErrorData({ code: 'nope', message: 'x' })).toEqual({ code: 'unknown', message: '[object Object]' });
  });

  it('maps SDK error names to codes', () => {
    expect(codeForExtensionError('CloudflareError')).toBe('cloudflare');
    expect(codeForExtensionError('TypeError')).toBe('extension');
    expect(codeForExtensionError(undefined)).toBe('extension');
  });
});
