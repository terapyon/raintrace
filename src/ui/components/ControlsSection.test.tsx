// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackSpeed } from '../../shared/protocol'
import { displayStats } from '../../state/displayStats.test-support'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import type { RainfallSettings } from '../../state/persistedSettings'
import { createSettingsStore } from '../../state/settingsStore'
import { createSimulationStore, type DisplayStats } from '../../state/simulationStore'
import { strings } from '../strings'
import { ControlsSection } from './ControlsSection'

afterEach(cleanup)

function setup({ hasTerrain = true } = {}) {
  const settings = createSettingsStore(memoryStorage())
  const simulation = createSimulationStore()
  const actions = {
    start: vi.fn((_rain: RainfallSettings) => simulation.getState().started()),
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

const intensity = () => screen.getByLabelText(strings.rainfall.intensity) as HTMLInputElement
const duration = () => screen.getByLabelText(strings.rainfall.duration) as HTMLSelectElement
const wholeRange = () => screen.getByLabelText(strings.rainfall.wholeRange) as HTMLInputElement
const radius = () => screen.getByLabelText(strings.rainfall.radius) as HTMLInputElement
const primary = () =>
  screen.getByRole('button', {
    name: new RegExp(
      `^(${strings.playback.start}|${strings.playback.pause}|${strings.playback.resume})$`,
    ),
  }) as HTMLButtonElement
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

/** 自動停止の統計（step だけを変える） */
const settledAt = (step: number): DisplayStats =>
  displayStats({ step, totalWater: 1, storedWater: 1, settled: true, stopReason: 'settled' })

async function replace(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLInputElement,
  text: string,
) {
  await user.clear(input)
  if (text !== '') await user.type(input, text)
}

describe('ControlsSection: 雨の入力と検証（spec 08 §4.1・§6.3、R08-7）', () => {
  it.each([
    ['1', true],
    ['300', true],
    ['0', false],
    ['301', false],
    ['1.5', false],
    ['', false],
  ])('時間雨量 %j で開始できる: %s', async (text, ok) => {
    const { user } = setup()
    await replace(user, intensity(), text)
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

  it('範囲 1000 m を選ぶと注意書きを出す。ほかの大きさでは出ない（spec 08 §6.2 の文）', async () => {
    const { user } = setup()
    expect(screen.queryByText(strings.rainfall.rangeSizeHeavyHint)).toBeNull()
    await user.click(button(strings.rainfall.rangeSizeValue(1000)))
    expect(screen.getByText(strings.rainfall.rangeSizeHeavyHint)).toBeTruthy()
    await user.click(button(strings.rainfall.rangeSizeValue(500)))
    expect(screen.queryByText(strings.rainfall.rangeSizeHeavyHint)).toBeNull()
  })

  it('範囲外の時間雨量は入力欄にエラーを出し、有効な値だけを設定に保存する', async () => {
    const { user, settings } = setup()
    await replace(user, intensity(), '80')
    expect(settings.getState().rainfall.intensityMmPerH).toBe(80)
    await replace(user, intensity(), '0')
    expect(screen.getByText(strings.rainfall.intensityError)).toBeTruthy()
    expect(settings.getState().rainfall.intensityMmPerH).toBe(80)
  })

  it('継続時間は 7 つの選択肢から選び、設定に保存する（既定は 1 時間）', async () => {
    const { user, settings } = setup()
    expect(duration().value).toBe('60')
    expect(Array.from(duration().options).map((o) => o.textContent)).toEqual([
      '10 分',
      '20 分',
      '30 分',
      '1 時間',
      '2 時間',
      '3 時間',
      '6 時間',
    ])
    await user.selectOptions(duration(), '120')
    expect(settings.getState().rainfall.durationMin).toBe(120)
  })

  it('範囲全体に降らせるをオンにすると半径の欄と半径のスライダーが無効になり、設定に保存する', async () => {
    const { user, settings } = setup()
    expect(wholeRange().checked).toBe(false)
    await user.click(wholeRange())
    expect(settings.getState().rainfall.wholeRange).toBe(true)
    expect(radius().disabled).toBe(true)
    expect(
      (screen.getByRole('slider', { name: strings.rainfall.radiusSlider }) as HTMLInputElement)
        .disabled,
    ).toBe(true)
  })

  it('範囲全体に降らせる間は半径を検証しない: 不正な半径でも開始でき、保存値の半径は前の有効な値のまま。オフに戻すとエラーで開始できない（Review Focus 5）', async () => {
    const { user, settings, actions } = setup()
    await replace(user, radius(), '0')
    expect(primary().disabled).toBe(true)
    await user.click(wholeRange())
    expect(primary().disabled).toBe(false)
    expect(screen.queryByText(strings.rainfall.radiusError(250))).toBeNull()
    await user.click(primary())
    expect(actions.start).toHaveBeenCalledWith({
      intensityMmPerH: 100,
      durationMin: 60,
      radiusM: 10,
      wholeRange: true,
    })
    expect(settings.getState().rainfall.radiusM).toBe(10)
    await user.click(button(strings.playback.pause))
    await user.click(button(strings.playback.reset))
    await user.click(wholeRange())
    expect(primary().disabled).toBe(true)
    expect(screen.getByText(strings.rainfall.radiusError(250))).toBeTruthy()
  })

  it('地形が無ければ開始できない', () => {
    setup({ hasTerrain: false })
    expect(primary().disabled).toBe(true)
  })

  it('開始の後はリセットするまで雨の入力（時間雨量・継続時間・範囲全体・半径）を変えられない', async () => {
    const { user } = setup()
    await user.click(primary())
    expect(intensity().disabled).toBe(true)
    expect(duration().disabled).toBe(true)
    expect(wholeRange().disabled).toBe(true)
    expect(radius().disabled).toBe(true)
    await user.click(button(strings.playback.pause))
    await user.click(button(strings.playback.reset))
    expect(intensity().disabled).toBe(false)
  })
})

describe('ControlsSection: 再生の操作', () => {
  it('キーボードだけで、時間雨量・半径の入力から開始・一時停止・リセットまで操作できる（tech-spec §9.5）', async () => {
    const { user, actions } = setup()
    await user.tab()
    expect(document.activeElement).toBe(intensity())
    await user.keyboard('{Control>}a{/Control}120')
    for (let n = 0; n < 20 && document.activeElement !== radius(); n++) await user.tab()
    expect(document.activeElement).toBe(radius())
    await user.keyboard('{Control>}a{/Control}15')
    for (let n = 0; n < 20 && document.activeElement !== primary(); n++) await user.tab()
    expect(document.activeElement).toBe(primary())
    await user.keyboard('{Enter}')
    expect(actions.start).toHaveBeenCalledWith({
      intensityMmPerH: 120,
      durationMin: 60,
      radiusM: 15,
      wholeRange: false,
    })
    // 同じボタンが「一時停止」になり、焦点は外れない
    expect(document.activeElement?.textContent).toBe(strings.playback.pause)
    await user.keyboard('{Enter}')
    expect(actions.pause).toHaveBeenCalledTimes(1)
    const reset = button(strings.playback.reset)
    for (let n = 0; n < 20 && document.activeElement !== reset; n++) await user.tab()
    await user.keyboard('{Enter}')
    expect(actions.reset).toHaveBeenCalledTimes(1)
  })

  it('一時停止中だけ 1 step 進められる。速度は「実時間」から「最速」まで選べる', async () => {
    const { user, actions } = setup()
    expect(button(strings.playback.step).disabled).toBe(true)
    await user.click(primary())
    await user.click(button(strings.playback.pause))
    await user.click(button(strings.playback.step))
    expect(actions.step).toHaveBeenCalledTimes(1)
    await user.click(button(strings.playback.speedValue(1)))
    expect(actions.setSpeed).toHaveBeenCalledWith(1)
    await user.click(button(strings.playback.max))
    expect(actions.setSpeed).toHaveBeenCalledWith('max')
  })

  it('水の動きが止まって自動停止したら「水の動きがほぼ止まりました（経過 …）」', () => {
    const { simulation } = setup()
    // React 19 では、act の外のストアの変更はすぐには DOM に出ない（useSyncExternalStore の更新を待つ）
    act(() => {
      simulation.getState().started()
      simulation.getState().settle(displayStats({ ...settledAt(123), timeS: 3 * 3600 + 600 }), 60)
    })
    expect(screen.getByText(strings.playback.settled('3時間10分'))).toBeTruthy()
  })

  it('雨の後の上限で止まったら、別の文「計算の上限（雨がやんでから 6 時間）に達しました（経過 …）」（spec 08 §6.2）', () => {
    const { simulation } = setup()
    act(() => {
      simulation.getState().started()
      simulation
        .getState()
        .settle(displayStats({ step: 9, settled: false, stopReason: 'cap', timeS: 8 * 3600 }), 60)
    })
    expect(screen.getByText(strings.playback.cap('8時間0分'))).toBeTruthy()
    expect(screen.queryByText(strings.playback.settled('8時間0分'))).toBeNull()
  })

  it('自動停止したら、主ボタンと「1 step 進める」は押せず、「リセット」だけを押せる', async () => {
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
