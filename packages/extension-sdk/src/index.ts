import type { ExtensionDefinition } from './types';

export * from './types';
export * from './errors';
export { SDK_API_VERSION } from './version';
export type { ExtensionManifest } from './manifest';
export { parseRelativeDate } from './date';
export type { HtmlElement, HttpRequest, HttpResponse } from './http';

/** Identity helper that gives extensions full typing; the build exposes it to the host. */
export function defineExtension(definition: ExtensionDefinition): ExtensionDefinition {
  return definition;
}
