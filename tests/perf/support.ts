/**
 * 計測（tests/perf）で共有する道具（spec 05 §4.4、spec 06 §4.2）。05 の fps.perf.ts から移した
 * （assertPerfBuild・query・withFreshPage・readReport・median）
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { type Browser, type BrowserContext, expect, type Page } from '@playwright/test'
import { percentile } from '../../src/map/fpsStats'
import { acknowledgeDisclaimer, collectErrors } from '../e2e/support/app'

/** S と同じ画面（spec 05 §4.4） */
export const VIEWPORT = { width: 960, height: 600 }

/** R06-1 の 3 地点（R02-7。04 の手動確認と同じ座標） */
export const SITES = {
  ayase: { label: '綾瀬', lat: '35.762300', lon: '139.824600' },
  shibuya: { label: '渋谷', lat: '35.658000', lon: '139.701600' },
  minatomirai: { label: 'みなとみらい', lat: '35.457500', lon: '139.632000' },
} as const
export type SiteName = keyof typeof SITES
const SITE_NAMES = Object.keys(SITES) as SiteName[]

/**
 * probe=load（クリックから表示まで）だけで測る地点（ユーザーの裁定 R5、2026-09-17。R06-1 からの承認済みの逸脱）。
 * DEM1A が無く DEM5A がある、段 2 の地点（2026-09-17 に地理院のタイルで確かめた。tests/perf/fixtures/README.md）。
 * fps・steps の組には入れない
 */
export const LOAD_ONLY_SITES = {
  nemuro: { label: '根室駅付近（段 2）', lat: '43.330000', lon: '145.582800' },
} as const
export const LOAD_SITES = { ...SITES, ...LOAD_ONLY_SITES } as const
export type LoadSiteName = keyof typeof LOAD_SITES
const LOAD_SITE_NAMES = Object.keys(LOAD_SITES) as LoadSiteName[]

/** カンマ区切りの環境変数を、許す値の一覧で確かめて読む。空なら fallback */
export function listFromEnv<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: readonly T[],
): T[] {
  if (value === undefined || value.trim() === '') return [...fallback]
  const items = value.split(',').map((item) => item.trim())
  for (const item of items) {
    if (!allowed.includes(item as T)) {
      throw new Error(`「${item}」は使えません（${allowed.join('・')}）`)
    }
  }
  return items as T[]
}

export const sitesFromEnv = (
  value: string | undefined,
  fallback: readonly SiteName[],
): SiteName[] => listFromEnv(value, SITE_NAMES, fallback)

/** probe=load の地点。R06-1 の 3 地点に LOAD_ONLY_SITES を足したものから選ぶ */
export const loadSitesFromEnv = (
  value: string | undefined,
  fallback: readonly LoadSiteName[],
): LoadSiteName[] => listFromEnv(value, LOAD_SITE_NAMES, fallback)

/** 結果の書き先。リポジトリの根からの相対（または絶対）のパス */
export function outDirFromEnv(value: string | undefined, fallback: string): URL {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
  return pathToFileURL(`${resolve(repoRoot, value ?? fallback)}/`)
}

/**
 * 計測用のビルド（pnpm build:perf）でなければフックが入らず、印は一生付かない。そのまま回すと timeout まで
 * 待たされ、「固まった」のか「ビルドし忘れた」のか分からない。先にビルドの情報（build-info/）を見て区別する
 */
export function assertPerfBuild(): void {
  const manifest = new URL('../../build-info/manifest.json', import.meta.url)
  if (!existsSync(manifest)) {
    throw new Error(
      'build-info/manifest.json がありません。先に pnpm build:perf を実行してください',
    )
  }
  if (!readFileSync(manifest, 'utf8').includes('perfHook')) {
    throw new Error(
      'dist が計測用のビルドではありません（manifest に perfHook が無い）。先に pnpm build:perf を実行してください',
    )
  }
}

export function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  )
  return `/?${new URLSearchParams(entries).toString()}`
}

/**
 * 1 回ずつ新しい context（HTTP の cache が空）で開く。同じページで続けると、後の条件ほど地理院のタイルが
 * cache から来て有利になる（05 の計画で決めたこと 20）。prepare は context の差し替え（context.route）を
 * ページを開く前に張るために使う
 */
export async function withFreshPage<T>(
  browser: Browser,
  baseURL: string,
  run: (page: Page) => Promise<T>,
  prepare?: (context: BrowserContext) => Promise<void>,
): Promise<T> {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORT, deviceScaleFactor: 1 })
  let closed = false
  try {
    await acknowledgeDisclaimer(context)
    if (prepare !== undefined) await prepare(context)
    const page = await context.newPage()
    const errors = collectErrors(page)
    const value = await run(page)
    expect(errors).toEqual([])
    // 報告を読んだ後（閉じるまでの間）に出たコンソールのエラーも見る。1 回目の確認だけだと取り逃す
    await context.close()
    closed = true
    expect(errors).toEqual([])
    return value
  } finally {
    if (!closed) await context.close()
  }
}

export type ReportAttribute =
  | 'data-fps-result'
  | 'data-steps-result'
  | 'data-load-result'
  | 'data-water-result'

/** 結果か失敗の印が付くまで待ち、結果を読む */
export async function readReport<T>(
  page: Page,
  attribute: ReportAttribute,
  timeoutMs: number,
): Promise<T> {
  await expect(page.locator(`html[${attribute}], html[data-perf-error]`)).toBeAttached({
    timeout: timeoutMs,
  })
  const failure = await page.locator('html').getAttribute('data-perf-error')
  if (failure !== null) throw new Error(`計測の失敗: ${failure}`)
  return JSON.parse((await page.locator('html').getAttribute(attribute)) ?? 'null') as T
}

/** 中央値（回数が偶数なら上側。percentile と同じ） */
export const median = (values: readonly number[]): number =>
  percentile(
    [...values].sort((a, b) => a - b),
    0.5,
  )
