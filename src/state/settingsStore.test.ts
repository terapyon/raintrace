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

const RAIN = { intensityMmPerH: 80, durationMin: 30, radiusM: 15, wholeRange: false } as const

/** URL に何も無いときの applyUrl の引数 */
const NO_URL = {
  sizeM: null,
  intensityMmPerH: null,
  durationMin: null,
  wholeRange: null,
  radiusM: null,
} as const

describe('settingsStore（tech-spec §8.3）', () => {
  it('保存が無ければ既定値', () => {
    const store = createSettingsStore(memoryStorage())
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
  })

  it('保存された値を読み込む', () => {
    const store = createSettingsStore(memoryStorage(saved({ rainfall: RAIN })))
    expect(store.getState().rainfall).toEqual(RAIN)
  })

  it('変更は §8.3 の形（schemaVersion 2）のまま保存する（zustand の { state, version } で包まない）', () => {
    const storage = memoryStorage()
    const store = createSettingsStore(storage)
    const rainfall = {
      intensityMmPerH: 200,
      durationMin: 120,
      radiusM: 30,
      wholeRange: true,
    } as const
    store.getState().setRainfall(rainfall)
    store.getState().acknowledgeDisclaimer('2026-09-12T00:00:00.000Z')
    expect(persisted(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      rainfall,
      disclaimerAcknowledgedAt: '2026-09-12T00:00:00.000Z',
    })
  })

  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>
  it.each<[string, unknown]>([
    ['schemaVersion が 3', { ...base, schemaVersion: 3 }],
    ['schemaVersion が無い', { ...base, schemaVersion: undefined }],
    ['時間雨量 0', { ...base, rainfall: { ...RAIN, intensityMmPerH: 0 } }],
    ['時間雨量が整数でない', { ...base, rainfall: { ...RAIN, intensityMmPerH: 1.5 } }],
    ['継続時間が選択肢に無い', { ...base, rainfall: { ...RAIN, durationMin: 45 } }],
    ['半径が範囲の半分を超える', { ...base, rainfall: { ...RAIN, radiusM: 251 } }],
    ['範囲の大きさが候補に無い', { ...base, area: { sizeM: 300 } }],
    [
      '垂直強調が候補に無い',
      { ...base, display: { ...DEFAULT_SETTINGS.display, verticalExaggeration: 3 } },
    ],
    [
      '矢印の表示が真偽値でない',
      { ...base, display: { ...DEFAULT_SETTINGS.display, showFlowVectors: 'yes' } },
    ],
    [
      '流出の表示が真偽値でない',
      { ...base, display: { ...DEFAULT_SETTINGS.display, showOutflowCells: 'yes' } },
    ],
    [
      '矢印の間隔が候補にも 5 にも無い',
      { ...base, display: { ...DEFAULT_SETTINGS.display, flowVectorSpacingM: 15 } },
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

  it('矢印の間隔の保存値が 5（外れた選択肢）なら 10 として読み、他の表示の設定はそのまま保つ（R06-11 の移行）', () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        ...DEFAULT_SETTINGS,
        display: { ...DEFAULT_SETTINGS.display, flowVectorSpacingM: 5 },
      }),
    })
    const store = createSettingsStore(storage)
    expect(store.getState().display).toEqual({
      ...DEFAULT_SETTINGS.display,
      flowVectorSpacingM: 10,
    })
  })

  it('範囲を小さくすると、半径を範囲の半分に収める（保存値が常に正しい形になる）', () => {
    const store = createSettingsStore(
      memoryStorage(saved({ area: { sizeM: 1000 }, rainfall: { ...RAIN, radiusM: 400 } })),
    )
    store.getState().setAreaSize(250)
    expect(store.getState().rainfall.radiusM).toBe(125)
  })

  it('v0.2.0・07 の保存値（schemaVersion 1）を読むと、雨量だけ既定に戻り、半径・注意事項の了解・表示は残る。次に変えたとき v2 で保存する（spec 08 §6.4、N1・N2）', () => {
    const { showOutflowCells: _, ...display } = DEFAULT_SETTINGS.display
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        ...DEFAULT_SETTINGS,
        schemaVersion: 1,
        rainfall: { amountMm: 80, radiusM: 15 },
        display,
        map: { basemap: 'photo', theme: 'dark' },
        disclaimerAcknowledgedAt: '2026-09-20T01:02:03.000Z',
      }),
    })
    const store = createSettingsStore(storage)
    expect(store.getState().disclaimerAcknowledgedAt).toBe('2026-09-20T01:02:03.000Z')
    expect(store.getState().rainfall).toEqual({ ...DEFAULT_SETTINGS.rainfall, radiusM: 15 })
    expect(store.getState().map).toEqual({ basemap: 'photo', theme: 'dark' })
    expect(store.getState().display.showOutflowCells).toBe(true)
    store.getState().setMap({ theme: 'light' })
    expect(persisted(storage)).toMatchObject({
      schemaVersion: 2,
      rainfall: { ...DEFAULT_SETTINGS.rainfall, radiusM: 15 },
    })
  })
})

describe('URL と localStorage の優先順位（tech-spec §3.3、spec 08 §6.4）', () => {
  it('両方にある項目は URL が勝ち、その値を保存する', () => {
    const storage = memoryStorage(saved({ area: { sizeM: 1000 }, rainfall: RAIN }))
    const store = createSettingsStore(storage)
    store.getState().applyUrl({
      ...NO_URL,
      intensityMmPerH: 50,
      durationMin: 120,
      wholeRange: true,
      radiusM: 20,
    })
    const rainfall = { intensityMmPerH: 50, durationMin: 120, wholeRange: true, radiusM: 20 }
    expect(store.getState()).toMatchObject({ area: { sizeM: 1000 }, rainfall })
    expect(persisted(storage)).toMatchObject({ rainfall })
  })

  it('URL に無い項目は保存値のまま（古い mm だけの URL では雨は保存値。N3）', () => {
    const store = createSettingsStore(memoryStorage(saved({ rainfall: RAIN })))
    store.getState().applyUrl({ ...NO_URL, radiusM: 20 })
    expect(store.getState().rainfall).toEqual({ ...RAIN, radiusM: 20 })
  })

  it('URL の不正な値は無視して保存値を使う。URL の size に合わない半径は範囲の半分に収める', () => {
    const store = createSettingsStore(
      memoryStorage(saved({ area: { sizeM: 1000 }, rainfall: { ...RAIN, radiusM: 300 } })),
    )
    store.getState().applyUrl({ ...NO_URL, sizeM: 250, intensityMmPerH: 0, radiusM: 200 })
    expect(store.getState()).toMatchObject({
      area: { sizeM: 250 },
      rainfall: { ...RAIN, radiusM: 125 },
    })
  })
})

describe('safeLocalStorage（spec 04 §10）', () => {
  it('window が無い（テストの node）ときは、読めば無し、書いても投げない', () => {
    const store = createSettingsStore(safeLocalStorage())
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
    expect(() => store.getState().setRainfall(RAIN)).not.toThrow()
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
