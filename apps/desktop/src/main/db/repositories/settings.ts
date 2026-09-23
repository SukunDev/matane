import { type AppSettings, DEFAULT_SETTINGS, appSettingsSchema } from '@manga-reader/shared';
import { eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { settings } from '../schema';

const APP_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];

export class SettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  getValue<T>(key: string, fallback: T): T {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return fallback;
    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  setValue(key: string, value: unknown): void {
    const valueJson = JSON.stringify(value);
    this.db
      .insert(settings)
      .values({ key, valueJson })
      .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
      .run();
  }

  /** Stored values are validated one by one, so a single corrupt key falls back to its default. */
  getAppSettings(): AppSettings {
    const rows = this.db.select().from(settings).where(inArray(settings.key, APP_SETTING_KEYS)).all();
    const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    const shape = appSettingsSchema.shape;
    for (const row of rows) {
      const key = row.key as keyof AppSettings;
      try {
        const parsed = shape[key].safeParse(JSON.parse(row.valueJson));
        if (parsed.success) result[key] = parsed.data;
      } catch {
        // keep default
      }
    }
    return appSettingsSchema.parse(result);
  }

  updateAppSettings(patch: Partial<AppSettings>): AppSettings {
    this.db.transaction((tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const valueJson = JSON.stringify(value);
        tx.insert(settings)
          .values({ key, valueJson })
          .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
          .run();
      }
    });
    return this.getAppSettings();
  }
}
