import { type PersistStorage, persist } from 'zustand/middleware'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  DEFAULT_SETTINGS,
  isValidAmountMm,
  isValidRadiusM,
  maxRadiusM,
  type PersistedSettings,
  parsePersistedSettings,
  type RangeSizeM,
  SETTINGS_KEY,
} from './persistedSettings'

/** localStorage と同じ形の、同期の保存先。テストでは memoryStorage に差し替える */
export interface SyncStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * window.localStorage を包む。使えない環境（プライベートモード、サイトデータの拒否）では、
 * 読めなければ無し、書けなければ捨てて、動作を続ける（spec 04 §10）
 */
export function safeLocalStorage(): SyncStorage {
  const storage = (): Storage | null => {
    try {
      return window.localStorage
    } catch {
      return null
    }
  }
  return {
    getItem: (key) => {
      try {
        return storage()?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    setItem: (key, value) => {
      try {
        storage()?.setItem(key, value)
      } catch {
        // 保存せずに続ける
      }
    },
    removeItem: (key) => {
      try {
        storage()?.removeItem(key)
      } catch {
        // 消せなくても続ける
      }
    },
  }
}

/** URL から読んだ値（tech-spec §3.3）。無い・読めない項目は null */
export interface UrlSettings {
  sizeM: RangeSizeM | null
  amountMm: number | null
  radiusM: number | null
}

export interface SettingsActions {
  setRainfall(rainfall: PersistedSettings['rainfall']): void
  /** 範囲の大きさ。半径は新しい範囲の半分に収める */
  setAreaSize(sizeM: RangeSizeM): void
  setDisplay(patch: Partial<PersistedSettings['display']>): void
  setMap(patch: Partial<PersistedSettings['map']>): void
  acknowledgeDisclaimer(at: string): void
  /** URL の値を適用する（URL > localStorage）。不正な値は無視する */
  applyUrl(overrides: UrlSettings): void
}

export type SettingsState = PersistedSettings & SettingsActions
export type SettingsStore = StoreApi<SettingsState>

/**
 * §8.3 の形のまま保存する。zustand の既定（{ state, version } で包む）を使わない。
 * 読んだ値はまだ信用しない（merge で検証する）
 */
function settingsStorage(storage: SyncStorage): PersistStorage<PersistedSettings> {
  return {
    getItem: (name) => {
      const raw = storage.getItem(name)
      if (raw === null) return null
      try {
        return { state: JSON.parse(raw) as PersistedSettings, version: 0 }
      } catch {
        return null
      }
    },
    setItem: (name, value) => storage.setItem(name, JSON.stringify(value.state)),
    removeItem: (name) => storage.removeItem(name),
  }
}

const clampRadius = (radiusM: number, sizeM: RangeSizeM): number =>
  Math.min(radiusM, maxRadiusM(sizeM))

/** UI 設定（tech-spec §8.1・§8.3）。zustand の persist（zustand に同梱）で保存する。同期の保存先なので作った時点で読み込み済み */
export function createSettingsStore(storage: SyncStorage): SettingsStore {
  return createStore<SettingsState>()(
    persist(
      (set) => ({
        ...DEFAULT_SETTINGS,
        setRainfall: (rainfall) => set({ rainfall }),
        setAreaSize: (sizeM) =>
          set((s) => ({
            area: { sizeM },
            rainfall: { ...s.rainfall, radiusM: clampRadius(s.rainfall.radiusM, sizeM) },
          })),
        setDisplay: (patch) => set((s) => ({ display: { ...s.display, ...patch } })),
        setMap: (patch) => set((s) => ({ map: { ...s.map, ...patch } })),
        acknowledgeDisclaimer: (at) => set({ disclaimerAcknowledgedAt: at }),
        applyUrl: ({ sizeM, amountMm, radiusM }) =>
          set((s) => {
            const size = sizeM ?? s.area.sizeM
            return {
              area: { sizeM: size },
              rainfall: {
                amountMm: isValidAmountMm(amountMm) ? amountMm : s.rainfall.amountMm,
                radiusM: isValidRadiusM(radiusM, size)
                  ? radiusM
                  : clampRadius(s.rainfall.radiusM, size),
              },
            }
          }),
      }),
      {
        name: SETTINGS_KEY,
        storage: settingsStorage(storage),
        partialize: (s): PersistedSettings => ({
          schemaVersion: 1,
          rainfall: s.rainfall,
          area: s.area,
          display: s.display,
          map: s.map,
          disclaimerAcknowledgedAt: s.disclaimerAcknowledgedAt,
        }),
        // 不正な値・schemaVersion の不一致なら既定値のまま（tech-spec §8.3）。zustand の version は使わない
        merge: (persistedState, current) => {
          const parsed = parsePersistedSettings(persistedState)
          return parsed === null ? current : { ...current, ...parsed }
        },
      },
    ),
  )
}
