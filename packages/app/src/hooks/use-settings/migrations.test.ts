import { describe, expect, it } from "vitest";
import { createInMemoryKeyValueStorage } from "./fakes";
import { APP_SETTINGS_KEY, SETTINGS_MIGRATIONS_KEY } from "./keys";
import { migrateAppSettings } from "./migrations";
import { DEFAULT_CLIENT_SETTINGS, type AppSettings, type SendBehavior } from "./storage";

function settingsWith(sendBehavior: SendBehavior): AppSettings {
  return { ...DEFAULT_CLIENT_SETTINGS, sendBehavior };
}

type Storage = ReturnType<typeof createInMemoryKeyValueStorage>;

function appliedIds(storage: Storage): string[] {
  const raw = storage.entries.get(SETTINGS_MIGRATIONS_KEY);
  return raw === undefined ? [] : JSON.parse(raw).applied;
}

function storedSendBehavior(storage: Storage): SendBehavior | undefined {
  const raw = storage.entries.get(APP_SETTINGS_KEY);
  return raw === undefined ? undefined : JSON.parse(raw).sendBehavior;
}

function storedContentFontSize(storage: Storage): number | undefined {
  const raw = storage.entries.get(APP_SETTINGS_KEY);
  return raw === undefined ? undefined : JSON.parse(raw).contentFontSize;
}

/** An in-memory storage whose write to `failingKey` always throws, as a full disk would. */
function createFailingWriteStorage(failingKey: string): Storage {
  const storage = createInMemoryKeyValueStorage();
  const setItem = storage.setItem.bind(storage);
  return Object.assign(storage, {
    async setItem(key: string, value: string) {
      if (key === failingKey) throw new Error(`write to ${key} failed`);
      await setItem(key, value);
    },
  });
}

describe("migrateAppSettings", () => {
  it("preserves explicit send modes even when the old steer marker is absent", async () => {
    for (const sendBehavior of ["interrupt", "steer", "queue"] as const) {
      const storage = createInMemoryKeyValueStorage();
      const result = await migrateAppSettings(settingsWith(sendBehavior), storage);
      expect(result.sendBehavior).toBe(sendBehavior);
      expect(storedSendBehavior(storage)).toBeUndefined();
    }
  });

  it("migrates every mobile 15px content preference to 16px", async () => {
    const storage = createInMemoryKeyValueStorage();
    const settings = { ...settingsWith("steer"), contentFontSize: 15 };

    const result = await migrateAppSettings(settings, storage, undefined, { native: true });

    expect(result.contentFontSize).toBe(16);
    expect(storedContentFontSize(storage)).toBe(16);
    expect(appliedIds(storage)).toEqual(["mobile-content-16"]);
  });

  it("leaves a 15px web content preference unchanged", async () => {
    const storage = createInMemoryKeyValueStorage();
    const settings = { ...settingsWith("steer"), contentFontSize: 15 };

    const result = await migrateAppSettings(settings, storage, undefined, { native: false });

    expect(result.contentFontSize).toBe(15);
    expect(storedContentFontSize(storage)).toBeUndefined();
    expect(appliedIds(storage)).toEqual([]);
  });

  it("lets a mobile user choose 15px after the default migration ran", async () => {
    const storage = createInMemoryKeyValueStorage();
    await migrateAppSettings(
      { ...settingsWith("steer"), contentFontSize: 15 },
      storage,
      undefined,
      { native: true },
    );

    const result = await migrateAppSettings(
      { ...settingsWith("steer"), contentFontSize: 15 },
      storage,
      undefined,
      { native: true },
    );

    expect(result.contentFontSize).toBe(15);
  });
  it("preserves migration IDs written by a newer client", async () => {
    const storage = createInMemoryKeyValueStorage({
      [SETTINGS_MIGRATIONS_KEY]: JSON.stringify({ applied: ["future-migration"] }),
    });
    await migrateAppSettings(
      { ...settingsWith("steer"), contentFontSize: 15 },
      storage,
      undefined,
      { native: true },
    );
    expect(appliedIds(storage)).toEqual(["future-migration", "mobile-content-16"]);
  });

  it("does not mark a failed settings write", async () => {
    const storage = createFailingWriteStorage(APP_SETTINGS_KEY);
    await expect(
      migrateAppSettings({ ...settingsWith("steer"), contentFontSize: 15 }, storage, undefined, {
        native: true,
      }),
    ).rejects.toThrow();
    expect(appliedIds(storage)).toEqual([]);
  });

  it("retries safely when the marker write fails after settings landed", async () => {
    const storage = createFailingWriteStorage(SETTINGS_MIGRATIONS_KEY);
    await expect(
      migrateAppSettings({ ...settingsWith("steer"), contentFontSize: 15 }, storage, undefined, {
        native: true,
      }),
    ).rejects.toThrow();
    expect(storedContentFontSize(storage)).toBe(16);
    const recovered = createInMemoryKeyValueStorage(Object.fromEntries(storage.entries));
    const result = await migrateAppSettings(
      { ...settingsWith("steer"), contentFontSize: 15 },
      recovered,
      undefined,
      { native: true },
    );
    expect(result.contentFontSize).toBe(16);
    expect(appliedIds(recovered)).toEqual(["mobile-content-16"]);
  });
});
