import type { SyncStorage } from './settingsStore'

/** テスト用の保存先（localStorage の代わり） */
export function memoryStorage(
  initial: Record<string, string> = {},
): SyncStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}
