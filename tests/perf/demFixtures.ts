/**
 * CPU で決まる計測（1 step の所要時間・平衡）の DEM を毎回同じにする（spec 06 §4.1、計画で決めたこと 5）。
 * E2E の routeGsi（tests/e2e/support/gsi.ts）と同じく browser context で差し替える（DEM の取得は Worker の中で
 * 行うので page.route では捕まらない）。
 * - record: 地理院から取り、本体を .cache/perf-dem/<SHA-256>.png に、パスごとの状態を
 *   tests/perf/fixtures/dem-manifest.json に書く（404 も覚える）
 * - replay: manifest の本体を返す。本体が無い・SHA-256 が合わなければ要求を止めて missing に数える。
 *   manifest に無い DEM の要求（3D の範囲の外のタイル）は地理院にそのまま流し、passthrough に数える
 * - live: 差し替えない
 * 背景地図のタイルは差し替えない
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { BrowserContext } from '@playwright/test'
import { fulfillNotFound, fulfillPng, GSI_TILE_URL } from '../e2e/support/gsi'

export type DemMode = 'record' | 'replay' | 'live'
export type DemManifestEntry = { status: 200; sha256: string; bytes: number } | { status: 404 }
/** キーは URL のパス（/xyz/<DEM>/<z>/<x>/<y>.png） */
export type DemManifest = Record<string, DemManifestEntry>

const manifestUrl = new URL('./fixtures/dem-manifest.json', import.meta.url)
const cacheDir = new URL('../../.cache/perf-dem/', import.meta.url)

/** 標高タイルのパス（src/dem/demSources.ts の PATHS と同じ 5 種） */
export const DEM_PATH =
  /^\/xyz\/(dem1a_png|dem5a_png|dem5b_png|dem5c_png|dem_png)\/\d+\/\d+\/\d+\.png$/

export const sha256 = (body: Buffer): string => createHash('sha256').update(body).digest('hex')

export function readManifest(): DemManifest {
  return existsSync(manifestUrl)
    ? (JSON.parse(readFileSync(manifestUrl, 'utf8')) as DemManifest)
    : {}
}

/** パスの順に並べて書く（差分を読みやすくする） */
export function writeManifest(manifest: DemManifest): void {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(manifestUrl, `${JSON.stringify(sorted, null, 2)}\n`)
}

export function demModeFromEnv(value: string | undefined): DemMode {
  if (value === undefined || value === '' || value === 'replay') return 'replay'
  if (value === 'record' || value === 'live') return value
  throw new Error(`RAINTRACE_DEM は record・replay・live のどれか: ${value}`)
}

export interface DemRouteCounts {
  fixture: number
  recorded: number
  passthrough: number
  missing: number
}

export async function routeDem(
  context: BrowserContext,
  mode: DemMode,
  manifest: DemManifest,
): Promise<DemRouteCounts> {
  const counts: DemRouteCounts = { fixture: 0, recorded: 0, passthrough: 0, missing: 0 }
  if (mode === 'live') return counts
  await context.route(GSI_TILE_URL, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (!DEM_PATH.test(path)) return route.fallback()
    if (mode === 'record') {
      const response = await route.fetch()
      const body = await response.body()
      if (response.status() === 404) {
        manifest[path] = { status: 404 }
      } else if (response.ok()) {
        const hash = sha256(body)
        mkdirSync(cacheDir, { recursive: true })
        writeFileSync(new URL(`${hash}.png`, cacheDir), body)
        manifest[path] = { status: 200, sha256: hash, bytes: body.length }
      }
      counts.recorded++
      return route.fulfill({ response, body })
    }
    const entry = manifest[path]
    if (entry === undefined) {
      counts.passthrough++
      return route.fallback()
    }
    if (entry.status === 404) {
      counts.fixture++
      return fulfillNotFound(route)
    }
    const file = new URL(`${entry.sha256}.png`, cacheDir)
    const body = existsSync(file) ? readFileSync(file) : null
    if (body === null || sha256(body) !== entry.sha256) {
      counts.missing++
      return route.abort()
    }
    counts.fixture++
    return fulfillPng(route, body)
  })
  return counts
}
