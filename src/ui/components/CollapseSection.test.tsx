// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeWorker } from '../../bridge/fakeWorker.test-support'
import { SimulationClient } from '../../bridge/SimulationClient'
import { DEBRIS_PRESETS } from '../../shared/debrisPresets'
import type { FillCandidate } from '../../shared/protocol'
import {
  type CollapseSummary,
  type CompareSummary,
  createAppStore,
  IDLE_COMPARE,
} from '../../state/appStore'
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
  const compare = vi.spyOn(session.collapse, 'compare').mockResolvedValue()
  const cancel = vi.spyOn(session.collapse, 'cancelCompare').mockImplementation(() => {})
  const setView = vi.spyOn(session.collapse, 'setView').mockResolvedValue()
  return { session, store, settings, compute, compare, cancel, setView }
}

const patch = (store: ReturnType<typeof createAppStore>, over: object) =>
  act(() => store.setState((s) => ({ collapse: { ...s.collapse, ...over } })))

const compared: CompareSummary = {
  before: { maxDepth: 0.5, floodedArea: 1000, storedWater: 100, outflowWater: 50 },
  after: { maxDepth: 0.98, floodedArea: 2200, storedWater: 160, outflowWater: 20 },
  damMaxDepthM: 2.5,
  newWaterAreaM2: 1200,
}

describe('CollapseSection', () => {
  it('候補の詳しい欄の「崩れたと仮定する」で openCollapse(id)、CollapseSection が出る', async () => {
    const { session, store, compute } = setup()
    render(
      <>
        <FillHistorySection session={session} />
        <CollapseSection session={session} compareMinutes={0} />
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
    render(<CollapseSection session={session} compareMinutes={0} />)
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
    render(<CollapseSection session={session} compareMinutes={0} />)
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
    render(<CollapseSection session={session} compareMinutes={0} />)
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
    render(<CollapseSection session={session} compareMinutes={0} />)
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
    render(<CollapseSection session={session} compareMinutes={0} />)
    patch(store, { status: 'ready', summary: summary() })
    expect(screen.getByText(strings.collapse.noDams)).toBeTruthy()
    expect(screen.queryByText(/範囲の外へ/)).toBeNull()
  })

  it('比べる: 重い設定では押す前に知らせ、計算中は進み具合と中止、done で表', async () => {
    const { session, store, compare, cancel } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'ready', summary: summary() })
    const { rerender } = render(<CollapseSection session={session} compareMinutes={0} />)
    expect(screen.queryByTestId('compare-estimate')).toBeNull()
    rerender(<CollapseSection session={session} compareMinutes={0.9} />)
    expect(screen.queryByTestId('compare-estimate')).toBeNull()
    rerender(<CollapseSection session={session} compareMinutes={12.4} />)
    expect(screen.getByTestId('compare-estimate').textContent).toBe(
      `${strings.collapse.compareEstimateMinutes(12)}${strings.collapse.compareEstimateNote}`,
    )
    rerender(<CollapseSection session={session} compareMinutes={150} />)
    expect(screen.getByTestId('compare-estimate').textContent).toContain('約 3 時間')
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.compare }))
    expect(compare).toHaveBeenCalledOnce()

    patch(store, {
      compare: {
        ...IDLE_COMPARE,
        status: 'running',
        side: 'after',
        progress: 0.3,
        remainingS: 150,
      },
    })
    const progress = screen.getByTestId('compare-progress')
    expect(progress.textContent).toContain('崩れた後を計算しています（残り約 3 分）')
    expect(within(progress).getAllByRole('progressbar')).toHaveLength(2)
    expect(within(progress).getByText(strings.collapse.sides.before)).toBeTruthy()
    // 計算中は設定を変えられない
    expect(
      (screen.getByRole('button', { name: strings.collapse.ratios[0.5] }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.cancel }))
    expect(cancel).toHaveBeenCalledOnce()

    const result: CompareSummary = {
      before: { maxDepth: 0.5, floodedArea: 1000, storedWater: 100, outflowWater: 50 },
      after: { maxDepth: 0.98, floodedArea: 2200, storedWater: 160, outflowWater: 20 },
      damMaxDepthM: 2.5,
      newWaterAreaM2: 1200,
    }
    patch(store, { compare: { ...IDLE_COMPARE, status: 'done', summary: result } })
    const table = screen.getByTestId('compare-result')
    expect(table.textContent).toContain(strings.collapse.compareAt)
    expect(table.textContent).toContain('+0.48 m')
    expect(table.textContent).toContain('+1200 m²')
    expect(table.textContent).toContain(strings.collapse.newWater('1200 m²'))
    expect(table.textContent).toContain(strings.collapse.table.damMaxDepth)
  })

  it('表の行の名前は spec 5.3 のとおり（範囲の中に溜まった水の量・範囲の外へ流れ出た水の量）', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'ready', summary: summary() })
    render(<CollapseSection session={session} compareMinutes={0} />)
    patch(store, { compare: { ...IDLE_COMPARE, status: 'done', summary: compared } })
    const table = screen.getByTestId('compare-result')
    expect(within(table).getByText('範囲の中に溜まった水の量')).toBeTruthy()
    expect(within(table).getByText('範囲の外へ流れ出た水の量')).toBeTruthy()
  })

  it('比べた後に雨の設定・範囲の大きさが変わると、表を残したまま比べ直しを促す', () => {
    const { session, store, settings } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'ready', summary: summary() })
    render(<CollapseSection session={session} compareMinutes={0} />)
    const { rainfall, area } = settings.getState()
    patch(store, {
      compare: {
        ...IDLE_COMPARE,
        status: 'done',
        summary: compared,
        settings: { ...rainfall, sizeM: area.sizeM },
      },
    })
    expect(screen.queryByTestId('compare-stale')).toBeNull()
    const change = (
      next: Partial<typeof rainfall>,
      sizeM: typeof area.sizeM = area.sizeM,
    ): string | null => {
      act(() => {
        settings.getState().setRainfall({ ...rainfall, ...next })
        settings.getState().setAreaSize(sizeM)
      })
      return screen.queryByTestId('compare-stale')?.textContent ?? null
    }
    expect(change({ intensityMmPerH: rainfall.intensityMmPerH + 10 })).toBe(
      strings.collapse.compareStale,
    )
    expect(screen.getByTestId('compare-result').textContent).toContain('+0.48 m')
    expect(change({})).toBeNull()
    expect(change({ durationMin: rainfall.durationMin === 60 ? 30 : 60 })).not.toBeNull()
    expect(change({ radiusM: rainfall.radiusM + 1 })).not.toBeNull()
    expect(change({ wholeRange: !rainfall.wholeRange })).not.toBeNull()
    expect(change({}, area.sizeM === 500 ? 1000 : 500)).not.toBeNull()
    expect(change({})).toBeNull()
  })

  it('「閉じる」で closeCollapse', async () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'ready', summary: summary() })
    render(<CollapseSection session={session} compareMinutes={0} />)
    await userEvent.click(screen.getByRole('button', { name: strings.collapse.close }))
    expect(store.getState().collapse.candidateId).toBeNull()
    expect(screen.queryByTestId('collapse-section')).toBeNull()
  })

  it('swapping の間は比べるボタンを押せない', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'ready', summary: summary(), swapping: true })
    render(<CollapseSection session={session} compareMinutes={0} />)
    expect(
      (screen.getByRole('button', { name: strings.collapse.compare }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('土砂の計算中の進み具合のバーに名前がある', () => {
    const { session, store } = setup()
    store.getState().openCollapse(3)
    patch(store, { status: 'computing', progress: 0.4 })
    render(<CollapseSection session={session} compareMinutes={0} />)
    expect(screen.getByRole('progressbar', { name: strings.collapse.computing })).toBeTruthy()
  })

  it('開いたとき、見える位置へ寄せる', () => {
    const { session, store } = setup()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<CollapseSection session={session} compareMinutes={0} />)
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
        <CollapseSection session={session} compareMinutes={150} />
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
