/**
 * Settings Service
 *
 * Key-value store for site configuration
 */

import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { settings } from "../db/schema.js";
import { now } from "../lib/time.js";
import { SETTINGS_KEYS, ONBOARDING_STATUS, type SettingsKey } from "../lib/constants.js";

export interface SettingsService {
  get(key: SettingsKey): Promise<string | null>;
  getAll(): Promise<Record<string, string>>;
  set(key: SettingsKey, value: string): Promise<void>;
  setMany(entries: Partial<Record<SettingsKey, string>>): Promise<void>;
  isOnboardingComplete(): Promise<boolean>;
  completeOnboarding(): Promise<void>;
}

export function createSettingsService(db: Database): SettingsService {
  return {
    async get(key) {
      const result = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      return result[0]?.value ?? null;
    },

    async getAll() {
      const rows = await db.select().from(settings);
      const result: Record<string, string> = {};
      for (const row of rows) {
        result[row.key] = row.value;
      }
      return result;
    },

    async set(key, value) {
      const timestamp = now();
      await db
        .insert(settings)
        .values({ key, value, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: timestamp },
        });
    },

    async setMany(entries) {
      const timestamp = now();
      const keys = Object.keys(entries) as SettingsKey[];

      for (const key of keys) {
        const value = entries[key];
        if (value !== undefined) {
          await db
            .insert(settings)
            .values({ key, value, updatedAt: timestamp })
            .onConflictDoUpdate({
              target: settings.key,
              set: { value, updatedAt: timestamp },
            });
        }
      }
    },

    async isOnboardingComplete() {
      const status = await this.get(SETTINGS_KEYS.ONBOARDING_STATUS);
      return status === ONBOARDING_STATUS.COMPLETED;
    },

    async completeOnboarding() {
      await this.set(SETTINGS_KEYS.ONBOARDING_STATUS, ONBOARDING_STATUS.COMPLETED);
    },
  };
}
