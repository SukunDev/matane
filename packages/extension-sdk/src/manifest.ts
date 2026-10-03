// Host/tooling only: imported via `@matane/extension-sdk/manifest` so zod never lands in extension bundles.
import { z } from 'zod';

export { SDK_API_VERSION } from './version.js';

export const extensionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes');

export const manifestSchema = z.object({
  /** Stable forever; never includes a language (BRAINSTORM.md §5.2). */
  id: extensionIdSchema,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'semver'),
  apiVersion: z.number().int().positive(),
  /** One line for the Extensions page and repo listings. */
  description: z.string().max(200).optional(),
  nsfw: z.boolean().default(false),
  rateLimit: z.object({ requests: z.number().int().positive(), perMs: z.number().int().positive() }).optional(),
  sources: z
    .array(z.object({ key: z.string().regex(/^[a-z0-9-]+$/), lang: z.string().min(2), name: z.string().min(1) }))
    .min(1),
});
export type ExtensionManifest = z.infer<typeof manifestSchema>;
