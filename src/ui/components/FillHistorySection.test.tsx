// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeWorker } from '../../bridge/fakeWorker.test-support'
import { SimulationClient } from '../../bridge/SimulationClient'
import type { FillCandidate } from '../../shared/protocol'
import {
  createAppStore,
  type FillHistoryStatus,
  type FillHistorySummary,
} from '../../state/appStore'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import { createSettingsStore } from '../../state/settingsStore'
import { createSimulationStore } from '../../state/simulationStore'
import { SimulationSession } from '../simulationSession'
import { strings } from '../strings'
import { TerrainSession } from '../terrainSession'
import { FillHistorySection } from './FillHistorySection'

afterEach(cleanup)

const candidate = (over: Partial<FillCandidate>): FillCandidate => ({
  id: 1,
  areaM2: 1200,
  maxRiseM: 7.26,
  volumeM3: 45169,
  centroid: { lon: 139.5, lat: 35.5 },
  evidence: 'limited',
  evidenceSources: [],
  ...over,
})

function setup() {
  const client = new SimulationClient(() => new FakeWorker())
  const settings = createSettingsStore(memoryStorage())
  const simulation = new SimulationSession(client, createSimulationStore(), settings)
  const store = createAppStore()
  const session = new TerrainSession(client, store, simulation, settings)
  render(<FillHistorySection session={session} />)
  const show = (status: FillHistoryStatus, summary: Partial<FillHistorySummary> | null) =>
    act(() => {
      store.setState({
        fillHistory: {
          enabled: true,
          status,
          summary: summary && {
            offsetM: -2.4,
            candidates: [],
            a54Available: true,
            landformAvailable: true,
            ...summary,
          },
          selectedId: null,
        },
      })
    })
  return { store, show }
}

describe('FillHistorySection', () => {
  it('スイッチをオンにすると setFillHistoryEnabled(true)', async () => {
    const { store } = setup()
    await userEvent.click(screen.getByLabelText(strings.fillHistory.enable))
    expect(store.getState().fillHistory.enabled).toBe(true)
  })

  it('ready で一覧が根拠の強い順に出て、行を押すと選ばれ、詳しい欄が開く', async () => {
    const { store, show } = setup()
    show('ready', {
      candidates: [
        candidate({ id: 3, evidence: 'strong' }),
        candidate({ id: 1, evidence: 'limited', volumeM3: 4520 }),
      ],
    })
    const rows = screen.getAllByTestId(/^fill-row-/)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['fill-row-3', 'fill-row-1'])
    expect(rows[0]?.textContent).toContain('参考の体積 約 4.5 万 m³')
    expect(rows[0]?.textContent).toContain('+7.3 m')
    expect(screen.getByTestId('fill-offset').textContent).toContain('−2.4 m')
    expect(screen.queryByTestId('fill-detail')).toBeNull()
    await userEvent.click(rows[1] as HTMLElement)
    expect(store.getState().fillHistory.selectedId).toBe(1)
    expect(screen.getByTestId('fill-detail').textContent).toContain('参考の体積 約 4,500 m³')
  })

  it('A54 と重なる候補の詳しい欄に「大規模盛土造成地に含まれます（谷埋め型）」', async () => {
    const { show } = setup()
    show('ready', {
      candidates: [
        candidate({ evidence: 'strong', evidenceSources: ['a54', 'landform'], a54Type: 'valley' }),
      ],
    })
    await userEvent.click(screen.getByTestId('fill-row-1'))
    const text = screen.getByTestId('fill-detail').textContent
    expect(text).toContain('大規模盛土造成地に含まれます（谷埋め型）')
    expect(text).toContain('人工地形の分類で盛土地とされています')
  })

  it('詳しい欄は選んだ行の li の中に出る。A54 の型が無くても「含まれます」を出す', async () => {
    const { show } = setup()
    show('ready', {
      candidates: [candidate({ id: 1 }), candidate({ id: 2, evidenceSources: ['a54'] })],
    })
    await userEvent.click(screen.getByTestId('fill-row-2'))
    const detail = screen.getByTestId('fill-detail')
    expect(screen.getByTestId('fill-row-2').closest('li')?.contains(detail)).toBe(true)
    expect(screen.getByTestId('fill-row-1').closest('li')?.contains(detail)).toBe(false)
    expect(detail.textContent).toContain('大規模盛土造成地に含まれます')
    expect(detail.textContent).not.toContain('（')
  })

  it('no-overlap でも昔と今のデータの名前を出す（ready と同じ）', () => {
    const { store, show } = setup()
    act(() =>
      store.getState().setTerrain({
        demLevel: 1,
        breakdown: { dem5a: 10 },
        cellSizeM: 5,
        invalidRatio: 0,
        elevationRange: null,
        depressionCount: 0,
        largestDepression: null,
      }),
    )
    show('no-overlap', null)
    expect(screen.getByText(strings.fillHistory.past)).toBeTruthy()
    expect(screen.getByText(/^今: /)).toBeTruthy()
    show('failed', null)
    expect(screen.queryByText(strings.fillHistory.past)).toBeNull()
  })

  it('候補が無ければ「ありません」', () => {
    const { show } = setup()
    show('ready', { candidates: [] })
    expect(screen.getByText(strings.fillHistory.none)).toBeTruthy()
  })

  it('waiting・loading・unavailable・no-overlap・failed・landformFailed・a54Failed の文言が出る', () => {
    const { show } = setup()
    const f = strings.fillHistory
    show('waiting', null)
    expect(screen.getByText(f.waiting)).toBeTruthy()
    show('loading', null)
    expect(screen.getByText(f.loading)).toBeTruthy()
    show('unavailable', null)
    expect(screen.getByText(f.unavailable)).toBeTruthy()
    show('no-overlap', null)
    expect(screen.getByText(f.noOverlap)).toBeTruthy()
    show('failed', null)
    expect(screen.getByText(f.failed)).toBeTruthy()
    show('ready', { landformAvailable: false, a54Available: false })
    expect(screen.getByText(f.landformFailed)).toBeTruthy()
    expect(screen.getByText(f.a54Failed)).toBeTruthy()
  })

  it('オンの間は注意書きが出て、文言に「危険」「盛土の候補」「盛土相当」を含まない', () => {
    const { show } = setup()
    show('ready', {
      candidates: [candidate({ evidence: 'strong', evidenceSources: ['a54'], a54Type: 'side' })],
    })
    expect(screen.getByText(strings.fillHistory.notice)).toBeTruthy()
    // 注意書きの「危険な箇所を示すものではありません」は趣旨を伝える否定の用法。注意書き以外で確かめる
    const text = (document.body.textContent ?? '').replace(strings.fillHistory.notice, '')
    expect(text).not.toMatch(/危険|盛土の候補|盛土相当|崩壊確率/)
    expect(strings.fillHistory.notice).not.toMatch(/盛土の候補|盛土相当|崩壊確率/)
  })

  it('オフのときは注意書きが出ない', () => {
    setup()
    expect(screen.queryByText(strings.fillHistory.notice)).toBeNull()
  })
})
