// Runs inside the QuickJS sandbox before the extension bundle. It turns the raw host primitives
// (`__hostSync`, `__hostAsync`: string op + JSON args → JSON result; `__hostBytes`: the same plus
// ArrayBuffers, for binary data) into the documented globals (BRAINSTORM.md §5.5), then hides the
// primitives. Plain ES2020, no imports.
export const PRELUDE = String.raw`
(() => {
  'use strict';
  const hostSync = globalThis.__hostSync;
  const hostAsync = globalThis.__hostAsync;
  const hostBytes = globalThis.__hostBytes;
  delete globalThis.__hostSync;
  delete globalThis.__hostAsync;
  delete globalThis.__hostBytes;

  const toError = (e) => {
    const error = new Error(e.message);
    error.name = e.name || 'ExtensionError';
    if (e.status !== undefined) error.status = e.status;
    return error;
  };
  const unwrap = (json) => {
    const result = JSON.parse(json);
    if (result.error) throw toError(result.error);
    return result.value;
  };
  const callSync = (op, args) => unwrap(hostSync(op, JSON.stringify(args)));
  const callAsync = (op, args) => hostAsync(op, JSON.stringify(args)).then(unwrap);

  // Binary data crosses as ArrayBuffers (no JSON), so images of several MB stay cheap.
  const toBytes = (value, what) => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (Array.isArray(value)) return new Uint8Array(value);
    if (typeof value === 'string') return new Uint8Array(callSync('utf8.encode', [value]));
    throw new TypeError(what + ' must be a Uint8Array, an array of numbers or a string');
  };
  const bufferOf = (bytes) =>
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  const callBytes = (op, args, ...buffers) => hostBytes(op, JSON.stringify(args), ...buffers);

  class HtmlElement {
    constructor(id) { this.__id = id; }
    select(selector) { return callSync('html.select', [this.__id, selector]).map((id) => new HtmlElement(id)); }
    selectFirst(selector) {
      const id = callSync('html.selectFirst', [this.__id, selector]);
      return id === null ? null : new HtmlElement(id);
    }
    text() { return callSync('html.text', [this.__id]); }
    html() { return callSync('html.html', [this.__id]); }
    attr(name) { const v = callSync('html.attr', [this.__id, name]); return v === null ? undefined : v; }
    absUrl(name) { const v = callSync('html.absUrl', [this.__id, name]); return v === null ? undefined : v; }
  }

  const ensureOk = (response, url) => {
    if (response.status < 200 || response.status > 299) {
      const error = new Error('HTTP ' + response.status + ' for ' + url);
      error.name = 'HttpError';
      error.status = response.status;
      throw error;
    }
    return response;
  };

  const format = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.name + ': ' + value.message;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  };
  const logAt = (level) => (...args) => { callSync('log', [level, args.map(format)]); };

  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value: Object.freeze(value), enumerable: false, writable: false });

  define('http', {
    request: (request) => callAsync('http.request', [request]),
    get: (url, options) => callAsync('http.request', [Object.assign({}, options, { url, method: 'GET' })]).then((r) => ensureOk(r, url)),
    post: (url, body, options) =>
      callAsync('http.request', [Object.assign({}, options, { url, method: 'POST', body })]).then((r) => ensureOk(r, url)),
  });
  define('html', { load: (body, options) => new HtmlElement(callSync('html.load', [String(body), options || {}])) });
  define('storage', {
    get: (key) => callAsync('storage.get', [key]).then((v) => (v === null ? undefined : v)),
    set: (key, value) => callAsync('storage.set', [key, value === undefined ? null : value]).then(() => undefined),
    remove: (key) => callAsync('storage.remove', [key]).then(() => undefined),
  });
  define('prefs', { get: (key) => { const v = callSync('prefs.get', [key]); return v === null ? undefined : v; } });
  define('log', { debug: logAt('debug'), info: logAt('info'), warn: logAt('warn'), error: logAt('error') });
  define('console', { log: logAt('info'), info: logAt('info'), debug: logAt('debug'), warn: logAt('warn'), error: logAt('error') });
  define('crypto', {
    md5: (text) => callSync('crypto.hash', ['md5', String(text)]),
    sha1: (text) => callSync('crypto.hash', ['sha1', String(text)]),
    sha256: (text) => callSync('crypto.hash', ['sha256', String(text)]),
    aesDecrypt: (data, key, options) => {
      const o = options || {};
      const iv = o.iv === undefined || o.iv === null ? undefined : bufferOf(toBytes(o.iv, 'iv'));
      return new Uint8Array(
        callBytes('aes.decrypt', [o.mode, o.padding !== false], bufferOf(toBytes(data, 'data')), bufferOf(toBytes(key, 'key')), iv),
      );
    },
  });
  define('base64', {
    encode: (text) => callSync('base64.encode', [String(text)]),
    decode: (text) => callSync('base64.decode', [String(text)]),
    decodeBytes: (text) => new Uint8Array(callBytes('base64.decodeBytes', [String(text)])),
    encodeBytes: (bytes) => callBytes('base64.encodeBytes', [], bufferOf(toBytes(bytes, 'bytes'))),
  });
  define('utf8', {
    encode: (text) => callSync('utf8.encode', [String(text)]),
    decode: (bytes) => callSync('utf8.decode', [Array.from(bytes)]),
  });
  define('timers', { sleep: (ms) => callAsync('sleep', [Number(ms) || 0]).then(() => undefined) });

  const OPTIONAL = ['getLatest', 'getFilters', 'getImageUrl', 'imageHeaders', 'resolveUrl', 'getWebUrl', 'reportImage', 'transformImage', 'migrateUrl'];

  // transformImage: the fetched bytes come from the host by id; restored bytes go back the same way.
  const transformImage = async (source, ioId, page) => {
    if (typeof source.transformImage !== 'function') throw new Error('Source does not implement transformImage');
    const input = new Uint8Array(callBytes('image.take', [ioId]));
    const result = await source.transformImage(page, input);
    if (!result || typeof result !== 'object') throw new TypeError('transformImage must return an object');
    let bytes = false;
    if (result.bytes !== undefined && result.bytes !== null) {
      callBytes('image.put', [ioId], bufferOf(toBytes(result.bytes, 'transformImage bytes')));
      bytes = true;
    }
    return { bytes, tiles: result.tiles === undefined ? null : result.tiles };
  };

  // migrateUrl for a batch, so an update does not cost one host round trip per manga or chapter.
  const migrateUrls = (source, items, fromVersion) => {
    if (typeof source.migrateUrl !== 'function') return { urls: items.map(() => null), errors: [] };
    const errors = [];
    const urls = items.map((item) => {
      try {
        const next = source.migrateUrl(item.url, item.kind, fromVersion);
        return typeof next === 'string' && next !== item.url ? next : null;
      } catch (e) {
        if (errors.length < 5) errors.push(item.url + ': ' + (e && e.message ? e.message : String(e)));
        return null;
      }
    });
    return { urls, errors };
  };
  const created = new Map();
  const sourceFor = (key) => {
    const extension = globalThis.__extension;
    if (!extension || typeof extension.createSource !== 'function') throw new Error('Extension did not register itself');
    let source = created.get(key);
    if (!source) {
      const info = globalThis.__sourceInfos[key];
      if (!info) throw new Error('Unknown source key: ' + key);
      source = extension.createSource(info);
      created.set(key, source);
    }
    return source;
  };

  // Entry point used by the host for every call. Returns a JSON string.
  Object.defineProperty(globalThis, '__call', {
    enumerable: false,
    value: async (key, method, argsJson) => {
      if (method === '__preferences') {
        const extension = globalThis.__extension;
        return JSON.stringify(extension && extension.preferences ? extension.preferences() : []);
      }
      const source = sourceFor(key);
      if (method === '__info') {
        return JSON.stringify({ baseUrl: source.baseUrl, capabilities: OPTIONAL.filter((m) => typeof source[m] === 'function') });
      }
      if (method === '__transformImage') return JSON.stringify(await transformImage(source, ...JSON.parse(argsJson)));
      if (method === '__migrateUrls') return JSON.stringify(migrateUrls(source, ...JSON.parse(argsJson)));
      const fn = source[method];
      if (typeof fn !== 'function') {
        const error = new Error('Source does not implement ' + method);
        error.name = 'NotImplementedError';
        throw error;
      }
      const result = await fn.apply(source, JSON.parse(argsJson));
      return JSON.stringify(result === undefined ? null : result);
    },
  });
})();
`;
