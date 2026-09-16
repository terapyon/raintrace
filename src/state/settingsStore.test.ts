import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './memoryStorage.test-support'
import { DEFAULT_SETTINGS, type PersistedSettings, SETTINGS_KEY } from './persistedSettings'
import { createSettingsStore, safeLocalStorage } from './settingsStore'

afterEach(() => {
  vi.unstubAllGlobals()
})

const saved = (patch: Partial<PersistedSettings> = {}): Record<string, string> => ({
  [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, ...patch }),
})

function persisted(storage: { data: Map<string, string> }): unknown {
  return JSON.parse(storage.data.get(SETTINGS_KEY) ?? 'null')
}

describe('settingsStore（tech-spec §8.3）', () => {
  it('保存が無ければ既定値', () => {
    const store = createSettingsStore(memoryStorage())
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
  })

  it('保存された値を読み込む', () => {
    const store = createSettingsStore(
      memoryStorage(saved({ rainfall: { amountMm: 80, radiusM: 15 } })),
    )
    expect(store.getState().rainfall).toEqual({ amountMm: 80, radiusM: 15 })
  })

  it('変更は §8.3 の形のまま保存する（zustand の { state, version } で包まない）', () => {
    const storage = memoryStorage()
    const store = createSettingsStore(storage)
    store.getState().setRainfall({ amountMm: 200, radiusM: 30 })
    store.getState().acknowledgeDisclaimer('2026-09-12T00:00:00.000Z')
    expect(persisted(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      rainfall: { amountMm: 200, radiusM: 30 },
      disclaimerAcknowledgedAt: '2026-09-12T00:00:00.000Z',
    })
  })

  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>
  it.each<[string, unknown]>([
    ['schemaVersion が 2', { ...base, schemaVersion: 2 }],
    ['schemaVersion が無い', { ...base, schemaVersion: undefined }],
    ['雨量 0', { ...base, rainfall: { amountMm: 0, radiusM: 10 } }],
    ['雨量が整数でない', { ...base, rainfall: { amountMm: 1.5, radiusM: 10 } }],
    ['雨量が文字列', { ...base, rainfall: { amountMm: '100', radiusM: 10 } }],
    ['半径が範囲の半分を超える', { ...base, rainfall: { amountMm: 100, radiusM: 251 } }],
    ['範囲の大きさが候補に無い', { ...base, area: { sizeM: 300 } }],
    [
      '垂直強調が候補に無い',
      { ...base, display: { ...DEFAULT_SETTINGS.display, verticalExaggeration: 3 } },
    ],
    [
      '矢印の表示が真偽値でない',
      { ...base, display: { ...DEFAULT_SETTINGS.display, showFlowVectors: 'yes' } },
    ],
    ['ベースマップが候補に無い', { ...base, map: { basemap: 'satellite', theme: 'system' } }],
    ['免責の了解が日時でない', { ...base, disclaimerAcknowledgedAt: 'yesterday' }],
    ['配列', []],
    ['null', null],
  ])('不正な値（%s）は既定値に戻す', (_, value) => {
    const store = createSettingsStore(memoryStorage({ [SETTINGS_KEY]: JSON.stringify(value) }))
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
  })

  it('JSON として読めない値も既定値に戻す', () => {
    const store = createSettingsStore(memoryStorage({ [SETTINGS_KEY]: '{' }))
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
  })

  it('範囲を小さくすると、半径を範囲の半分に収める（保存値が常に正しい形になる）', () => {
    const store = createSettingsStore(
      memoryStorage(saved({ area: { sizeM: 1000 }, rainfall: { amountMm: 100, radiusM: 400 } })),
    )
    store.getState().setAreaSize(250)
    expect(store.getState().rainfall.radiusM).toBe(125)
  })
})

describe('URL と localStorage の優先順位（tech-spec §3.3）', () => {
  it('両方にある項目は URL が勝ち、その値を保存する', () => {
    const storage = memoryStorage(
      saved({ area: { sizeM: 1000 }, rainfall: { amountMm: 80, radiusM: 15 } }),
    )
    const store = createSettingsStore(storage)
    store.getState().applyUrl({ sizeM: null, amountMm: 50, radiusM: 20 })
    expect(store.getState()).toMatchObject({
      area: { sizeM: 1000 },
      rainfall: { amountMm: 50, radiusM: 20 },
    })
    expect(persisted(storage)).toMatchObject({ rainfall: { amountMm: 50, radiusM: 20 } })
  })

  it('URL の不正な値は無視して保存値を使う。URL の size に合わない半径は範囲の半分に収める', () => {
    const store = createSettingsStore(
      memoryStorage(saved({ area: { sizeM: 1000 }, rainfall: { amountMm: 80, radiusM: 300 } })),
    )
    store.getState().applyUrl({ sizeM: 250, amountMm: 0, radiusM: 200 })
    expect(store.getState()).toMatchObject({
      area: { sizeM: 250 },
      rainfall: { amountMm: 80, radiusM: 125 },
    })
  })
})

describe('safeLocalStorage（spec 04 §10）', () => {
  it('window が無い（テストの node）ときは、読めば無し、書いても投げない', () => {
    const store = createSettingsStore(safeLocalStorage())
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
    expect(() => store.getState().setRainfall({ amountMm: 5, radiusM: 5 })).not.toThrow()
  })

  it('localStorage の読み書きが投げる環境（プライベートモードなど）でも動作を続ける', () => {
    const fail = (): never => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('window', { localStorage: { getItem: fail, setItem: fail, removeItem: fail } })
    const store = createSettingsStore(safeLocalStorage())
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
    expect(() => store.getState().setMap({ basemap: 'photo' })).not.toThrow()
    expect(store.getState().map.basemap).toBe('photo')
  })
})
