// Host/tooling only: imported via `@manga-reader/extension-sdk/manifest` so zod never lands in extension bundles.
import { z } from 'zod';

export { SDK_API_VERSION } from './version';

const extensionId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes');
const domain = z.string().regex(/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/i, 'hostname, optionally prefixed with *.');

export const manifestSchema = z.object({
  /** Stable forever; never includes a language (BRAINSTORM.md §5.2). */
  id: extensionId,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'semver'),
  apiVersion: z.number().int().positive(),
  nsfw: z.boolean().default(false),
  /** Allowlist for `http`. Redirects outside the list are refused too. */
  domains: z.array(domain).min(1),
  rateLimit: z.object({ requests: z.number().int().positive(), perMs: z.number().int().positive() }).optional(),
  sources: z
    .array(z.object({ key: z.string().regex(/^[a-z0-9-]+$/), lang: z.string().min(2), name: z.string().min(1) }))
    .min(1),
});
export type ExtensionManifest = z.infer<typeof manifestSchema>;

/** `*.example.com` matches subdomains only; `example.com` matches exactly. */
export function isAllowedHost(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return domains.some((pattern) => {
    const p = pattern.toLowerCase();
    return p.startsWith('*.') ? host.endsWith(p.slice(1)) && host.length > p.length - 1 : host === p;
  });
}
