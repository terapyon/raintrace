// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackSpeed } from '../../shared/protocol'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import { createSettingsStore } from '../../state/settingsStore'
import { createSimulationStore, type DisplayStats } from '../../state/simulationStore'
import { strings } from '../strings'
import { ControlsSection } from './ControlsSection'

afterEach(cleanup)

function setup({ hasTerrain = true } = {}) {
  const settings = createSettingsStore(memoryStorage())
  const simulation = createSimulationStore()
  const actions = {
    start: vi.fn((_amountMm: number, _radiusM: number) => simulation.getState().started()),
    pause: vi.fn(() => simulation.getState().paused()),
    resume: vi.fn(() => simulation.getState().resumed()),
    step: vi.fn(),
    reset: vi.fn(() => simulation.getState().reset()),
    setSpeed: vi.fn((speed: PlaybackSpeed) => simulation.getState().setSpeed(speed)),
  }
  const onReload = vi.fn()
  render(
    <ControlsSection
      settings={settings}
      simulation={simulation}
      hasTerrain={hasTerrain}
      actions={actions}
      onReload={onReload}
    />,
  )
  return { settings, simulation, actions, onReload, user: userEvent.setup() }
}

const amount = () => screen.getByLabelText(strings.rainfall.amount) as HTMLInputElement
const radius = () => screen.getByLabelText(strings.rainfall.radius) as HTMLInputElement
const primary = () =>
  screen.getByRole('button', {
    name: new RegExp(
      `^(${strings.playback.start}|${strings.playback.pause}|${strings.playback.resume})$`,
    ),
  }) as HTMLButtonElement
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

/** 平衡の統計（step だけを変える） */
const settledAt = (step: number): DisplayStats => ({
  step,
  totalWater: 1,
  storedWater: 1,
  outflowWater: 0,
  maxDepth: 0,
  floodedArea: 0,
  settled: true,
  massError: 0,
})

async function replace(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLInputElement,
  text: string,
) {
  await user.clear(input)
  if (text !== '') await user.type(input, text)
}

describe('ControlsSection: 入力の検証（spec 04 §9、R04-6）', () => {
  it.each([
    ['1', true],
    ['1000', true],
    ['0', false],
    ['1001', false],
    ['1.5', false],
    ['', false],
  ])('雨量 %j で開始できる: %s', async (text, ok) => {
    const { user } = setup()
    await replace(user, amount(), text)
    expect(primary().disabled).toBe(!ok)
  })

  it.each([
    ['1', true],
    ['250', true],
    ['0.9', false],
    ['250.5', false],
  ])('範囲 500 m で半径 %j なら開始できる: %s', async (text, ok) => {
    const { user } = setup()
    await replace(user, radius(), text)
    expect(primary().disabled).toBe(!ok)
  })

  it('範囲を 250 m にすると半径の上限は 125 m', async () => {
    const { user } = setup()
    await user.click(button(strings.rainfall.rangeSizeValue(250)))
    await replace(user, radius(), '126')
    expect(primary().disabled).toBe(true)
    expect(screen.getByText(strings.rainfall.radiusError(125))).toBeTruthy()
    await replace(user, radius(), '125')
    expect(primary().disabled).toBe(false)
  })

  it('範囲外の雨量は入力欄にエラーを出し、有効な値だけを設定に保存する', async () => {
    const { user, settings } = setup()
    await replace(user, amount(), '80')
    expect(settings.getState().rainfall.amountMm).toBe(80)
    await replace(user, amount(), '0')
    expect(screen.getByText(strings.rainfall.amountError)).toBeTruthy()
    expect(settings.getState().rainfall.amountMm).toBe(80)
  })

  it('地形が無ければ開始できない', () => {
    setup({ hasTerrain: false })
    expect(primary().disabled).toBe(true)
  })

  it('開始の後はリセットするまで雨量・半径を入力できない', async () => {
    const { user } = setup()
    await user.click(primary())
    expect(amount().disabled).toBe(true)
    expect(radius().disabled).toBe(true)
    await user.click(button(strings.playback.pause))
    await user.click(button(strings.playback.reset))
    expect(amount().disabled).toBe(false)
  })
})

describe('ControlsSection: 再生の操作', () => {
  it('キーボードだけで、雨量・半径の入力から開始・一時停止・リセットまで操作できる（tech-spec §9.5）', async () => {
    const { user, actions } = setup()
    await user.tab()
    expect(document.activeElement).toBe(amount())
    await user.keyboard('{Control>}a{/Control}120')
    while (document.activeElement !== radius()) await user.tab()
    await user.keyboard('{Control>}a{/Control}15')
    for (let n = 0; n < 20 && document.activeElement !== primary(); n++) await user.tab()
    expect(document.activeElement).toBe(primary())
    await user.keyboard('{Enter}')
    expect(actions.start).toHaveBeenCalledWith(120, 15)
    // 同じボタンが「一時停止」になり、焦点は外れない
    expect(document.activeElement?.textContent).toBe(strings.playback.pause)
    await user.keyboard('{Enter}')
    expect(actions.pause).toHaveBeenCalledTimes(1)
    const reset = button(strings.playback.reset)
    for (let n = 0; n < 20 && document.activeElement !== reset; n++) await user.tab()
    await user.keyboard('{Enter}')
    expect(actions.reset).toHaveBeenCalledTimes(1)
  })

  it('一時停止中だけ 1 step 進められる。速度は「最速」を含めて選べる', async () => {
    const { user, actions } = setup()
    expect(button(strings.playback.step).disabled).toBe(true)
    await user.click(primary())
    await user.click(button(strings.playback.pause))
    await user.click(button(strings.playback.step))
    expect(actions.step).toHaveBeenCalledTimes(1)
    await user.click(button(strings.playback.max))
    expect(actions.setSpeed).toHaveBeenCalledWith('max')
  })

  it('平衡に達したら「平衡に達しました（Step N）」', () => {
    const { simulation } = setup()
    // React 19 では、act の外のストアの変更はすぐには DOM に出ない（useSyncExternalStore の更新を待つ）
    act(() => {
      simulation.getState().started()
      simulation.getState().settle(settledAt(123), 60)
    })
    expect(screen.getByText(strings.playback.settled(123))).toBeTruthy()
  })

  it('平衡に達したら、主ボタンと「1 step 進める」は押せず、「リセット」だけを押せる', async () => {
    const { user, simulation } = setup()
    await user.click(primary())
    act(() => simulation.getState().settle(settledAt(40), 60))
    expect(primary().disabled).toBe(true)
    expect(button(strings.playback.step).disabled).toBe(true)
    expect(button(strings.playback.reset).disabled).toBe(false)
  })

  it('Worker の異常終了では「再読み込み」を出し、押すと範囲を読み込み直す', async () => {
    const { user, simulation, onReload } = setup()
    act(() => simulation.getState().failed('worker'))
    expect(screen.getByText(strings.simErrors.worker)).toBeTruthy()
    expect(primary().disabled).toBe(true)
    await user.click(button(strings.playback.reload))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('降雨中心に標高データが無ければ、その旨を出す（spec 04 §10）', () => {
    const { simulation } = setup()
    act(() => simulation.getState().failed('no-elevation-at-rain-center'))
    expect(screen.getByText(strings.simErrors['no-elevation-at-rain-center'])).toBeTruthy()
  })
})
