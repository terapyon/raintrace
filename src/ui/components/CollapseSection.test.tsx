// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeWorker } from '../../bridge/fakeWorker.test-support'
import { SimulationClient } from '../../bridge/SimulationClient'
import { DEBRIS_PRESETS } from '../../shared/debrisPresets'
import type { FillCandidate } from '../../shared/protocol'
import { type CollapseSummary, createAppStore } from '../../state/appStore'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import { createSettingsStore } from '../../state/settingsStore'
import { createSimulationStore } from '../../state/simulationStore'
import { SimulationSession } from '../simulationSession'
import { strings } from '../strings'
import { TerrainSession } from '../terrainSession'
import { CollapseSection } from './CollapseSection'
import { FillHistorySection } from './FillHistorySection'
import { ScenarioToggle } from './ScenarioToggle'

afterEach(cleanup)

const candidate: FillCandidate = {
  id: 3,
  areaM2: 1200,
  maxRiseM: 7.26,
  volumeM3: 45169,
  centroid: { lon: 139.5, lat: 35.5 },
  evidence: 'strong',
  evidenceSources: [],
}

const summary = (over: Partial<CollapseSummary> = {}): CollapseSummary => ({
  candidateId: 3,
  ratio: 1,
  presetId: 'near',
  collapsedM3: 45000,
  depositedM3: 41000,
  outsideM3: 0,
  dams: [],
  culvert: null,
  ...over,
})

function setup() {
  const client = new SimulationClient(() => new FakeWorker())
  const settings = createSettingsStore(memoryStorage())
  const simulation = new SimulationSession(client, createSimulationStore(), settings)
  const store = createAppStore()
  const session = new TerrainSession(client, store, simulation, settings)
  store.setState({
    fillHistory: {
      enabled: true,
      status: 'ready',
      summary: {
        offsetM: 0,
        candidates: [candidate],
        a54Available: true,
        landformAvailable: true,
      },
      selectedId: 3,
    },
  })
  const compute = vi.spyOn(session.collapse, 'compute').mockResolvedValue()
  const setView = vi.spyOn(session.collapse, 'setView').mockResolvedValue()
  return { session, store, settings, compute, setView }
}

const patch = (store: ReturnType<typeof createAppStore>, over: object) =>
  act(() => store.setState((s) => ({ collapse: { ...s.collapse, ...over } })))

describe('CollapseSection', () => {
  it('候補の詳しい欄の「崩れたと仮定する」で openCollapse(id)、CollapseSection が出る', async () => {
    const { session, store, compute } = setup()
    render(
      <>
        <FillHistorySection session={session} />
        <CollapseSection session={session} />
      </>,
    )
    expect(screen.queryByTestId('collapse-section')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.open }))
    expect(store.getState().collapse.candidateId).toBe(3)
    expect(store.getState().fillHistory.selectedId).toBe(3)
    expect(screen.getByTestId('collapse-section')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.compute }))
    expect(compute).toHaveBeenCalledOnce()
    // もう一度押しても、開いた状態（と選んだ設定）は消えない
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.ratios[0.5] }))
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.open }))
    expect(store.getState().collapse.ratio).toBe(0.5)
  })

  it('崩れる量・流れやすさの選択肢は DEBRIS_PRESETS の行の数だけ出る', async () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    render(<CollapseSection session={session} />)
    const group = screen.getByRole('group', { name: strings.collapse.preset })
    expect(within(group).getAllByRole('button')).toHaveLength(DEBRIS_PRESETS.length)
    // ツールチップの説明が名前を上書きしない
    for (const p of DEBRIS_PRESETS) {
      expect(within(group).getByRole('button', { name: p.label })).toBeTruthy()
    }
    expect(
      within(screen.getByRole('group', { name: strings.collapse.ratio })).getAllByRole('button'),
    ).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.ratios[0.5] }))
    expect(store.getState().collapse.ratio).toBe(0.5)
  })

  it('計算するボタンは idle で compute、ready では出ない', async () => {
    const { session, store, compute } = setup()
    store.getState().openCollapse(3)
    render(<CollapseSection session={session} />)
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.compute }))
    expect(compute).toHaveBeenCalledOnce()
    patch(store, { status: 'computing', progress: 0.4 })
    expect(screen.getByText(strings.collapse.computing)).toBeTruthy()
    patch(store, { status: 'ready', summary: summary() })
    expect(screen.queryByRole('button', { name: strings.collapse.compute })).toBeNull()
  })

  it('せき止めが 5 か所を超えたら、一覧は上位 5 行と「ほか N か所」。見出しは全部の数と合計', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    render(<CollapseSection session={session} />)
    const dams = Array.from({ length: 8 }, (_, i) => ({
      depressionId: i + 1,
      capacityM3: 1000 * (8 - i),
      addedCapacityM3: 500,
      maxDepthM: 1,
      areaM2: 300,
      spillElevation: 20,
      spill: { lon: 0, lat: 0 },
    }))
    patch(store, { status: 'ready', summary: summary({ dams }) })
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText(strings.collapse.damsMore(3))).toBeTruthy()
    expect(screen.getByText(/せき止められた場所: 8 か所/)).toBeTruthy()
  })

  it('ready で崩れた土・積もった土・せき止めの行が出る。outsideM3 > 0 で範囲の外の知らせ', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    render(<CollapseSection session={session} />)
    patch(store, {
      status: 'ready',
      summary: summary({
        outsideM3: 4000,
        dams: [
          {
            depressionId: 2,
            capacityM3: 12000,
            addedCapacityM3: 5000,
            maxDepthM: 2.5,
            areaM2: 800,
            spillElevation: 31.2,
            spill: { lon: 0, lat: 0 },
          },
          {
            depressionId: 9,
            capacityM3: 3000,
            addedCapacityM3: 1000,
            maxDepthM: 1,
            areaM2: 300,
            spillElevation: 40,
            spill: { lon: 0, lat: 0 },
          },
        ],
      }),
    })
    const result = screen.getByTestId('collapse-result')
    expect(result.textContent).toContain('約 4.5 万 m³')
    expect(result.textContent).toContain(strings.collapse.outside('約 4,000 m³'))
    expect(result.textContent).toContain(strings.collapse.outsideNotice('約 4,000 m³'))
    expect(result.textContent).toContain('せき止められた場所: 2 か所（溜まりうる水 約 1.5 万 m³）')
    // 行は溜まりうる水（capacityM3）を、場所の番号は並びの順で出す
    expect(result.textContent).toContain('場所 1　溜まりうる水 約 1.2 万 m³')
    expect(result.textContent).toContain('場所 2　溜まりうる水 約 3,000 m³')
    expect(result.textContent).toContain('あふれ出す標高 31.20 m')
    expect(result.textContent).toContain('最大の深さ 2.50 m')
  })

  it('dams が空なら「せき止められた場所はありません」、範囲の外が 0 なら知らせは出ない', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    render(<CollapseSection session={session} />)
    patch(store, { status: 'ready', summary: summary() })
    expect(screen.getByText(strings.collapse.noDams)).toBeTruthy()
    expect(screen.queryByText(/範囲の外へ/)).toBeNull()
  })

  it('「閉じる」で closeCollapse', async () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'ready', summary: summary() })
    render(<CollapseSection session={session} />)
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.close }))
    expect(store.getState().collapse.candidateId).toBeNull()
    expect(screen.queryByTestId('collapse-section')).toBeNull()
  })

  it('「崩れる前と後を比べる」のボタンと目安が無い', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'ready', summary: summary() })
    render(<CollapseSection session={session} />)
    expect(screen.queryByRole('button', { name: '崩れる前と後を比べる' })).toBeNull()
    expect(screen.queryByTestId('compare-estimate')).toBeNull()
    expect(screen.queryByTestId('compare-progress')).toBeNull()
    expect(screen.queryByTestId('compare-result')).toBeNull()
  })

  it('土砂の計算中の進み具合のバーに名前がある', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'computing', progress: 0.4 })
    render(<CollapseSection session={session} />)
    expect(screen.getByRole('progressbar', { name: strings.collapse.computing })).toBeTruthy()
  })

  it('開いたとき、見える位置へ寄せる', () => {
    const { session, store } = setup()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<CollapseSection session={session} />)
    expect(scroll).not.toHaveBeenCalled()
    act(() => store.getState().openCollapse(3))
    expect(scroll).toHaveBeenCalledOnce()
  })

  it('画面の文字に「崩壊確率」「被害」「危険」を含まない', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'ready', summary: summary({ outsideM3: 10 }) })
    const { container } = render(
      <>
        <CollapseSection session={session} />
        <ScenarioToggle session={session} />
      </>,
    )
    const text = container.textContent ?? ''
    const all =
      text +
      JSON.stringify(Object.values(strings.collapse).map(String)) +
      JSON.stringify(strings.scenario)
    for (const word of ['崩壊確率', '被害', '危険']) expect(all).not.toContain(word)
    expect(text).toContain(strings.collapse.notice)
  })
})

describe('ScenarioToggle', () => {
  it('ready のときだけ出て、押すと setView', async () => {
    const { session, store, setView } = setup()
    store.getState().openCollapse(3)
    render(<ScenarioToggle session={session} />)
    expect(screen.queryByRole('group', { name: strings.scenario.label })).toBeNull()
    patch(store, { status: 'ready', summary: summary() })
    await userEvent.click(screen.getByRole('button', { name: strings.scenario.after }))
    expect(setView).toHaveBeenCalledWith('after')
  })

  it('swapping の間は押せない', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'ready', summary: summary(), swapping: true })
    render(<ScenarioToggle session={session} />)
    expect(
      (screen.getByRole('button', { name: strings.scenario.after }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
