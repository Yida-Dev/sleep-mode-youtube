import type { StorageSchema } from "./types";
import { DEFAULT_PRESET_ID } from "./constants";

const STORAGE_DEFAULTS: StorageSchema = {
  enabled: false,
  presetId: DEFAULT_PRESET_ID,
  masterGainDb: -6.0,
  eqEnabled: true,
  vocalEnhance: true,
};

export async function loadSettings(): Promise<StorageSchema> {
  const result = await chrome.storage.sync.get(STORAGE_DEFAULTS);
  return result as StorageSchema;
}

export async function saveSettings(
  partial: Partial<StorageSchema>
): Promise<void> {
  await chrome.storage.sync.set(partial);
}

export function onSettingsChanged(
  callback: (changes: Partial<StorageSchema>) => void
): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const parsed: Partial<StorageSchema> = {};
    for (const key of Object.keys(changes) as Array<keyof StorageSchema>) {
      if (key in STORAGE_DEFAULTS) {
        (parsed as Record<string, unknown>)[key] = changes[key].newValue;
      }
    }
    if (Object.keys(parsed).length > 0) {
      callback(parsed);
    }
  });
}
