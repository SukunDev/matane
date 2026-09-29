import type { ExtensionDefinition } from './types.js';

export * from './types.js';
export * from './errors.js';
export { SDK_API_VERSION } from './version.js';
export type { ExtensionManifest } from './manifest.js';
export { parseRelativeDate } from './date.js';
export type { HtmlElement, HttpRequest, HttpResponse } from './http.js';

/** Identity helper that gives extensions full typing; the build exposes it to the host. */
export function defineExtension(definition: ExtensionDefinition): ExtensionDefinition {
  return definition;
}
