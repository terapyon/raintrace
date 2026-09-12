import { existsSync, readFileSync } from 'node:fs'
import { type BrowserContext, expect, type Page } from '@playwright/test'
import { routeGsi } from '../../../tests/e2e/support/gsi'
import type { View } from '../../src/types'

export const EXAGGERATIONS = [1, 2, 5, 10] as const
export const PITCHES = [0, 45, 60, 85] as const
export const ZOOMS = [15, 16, 17, 18] as const

/** 64 通りの視点（計画 D10）。ズーム → 垂直強調 → pitch の順（コンタクトシートの行と列の順） */
export function allViews(): View[] {
  return ZOOMS.flatMap((zoom) =>
    EXAGGERATIONS.flatMap((exaggeration) =>
      PITCHES.map((pitch) => ({ zoom, exaggeration, pitch })),
    ),
  )
}

export function spikeQuery(query: Record<string, string | number>): string {
  return `/?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()}`
}

const demDir = new URL('../../fixtures/gsi/', import.meta.url)

/**
 * DEM1A の要求に spike/fixtures/gsi/ の実タイル（Task 1 Step 10b で一度だけ取得）で応答する。無いタイルは 404。
 * routeGsi の後に登録するので、DEM1A ではこちらが先に効く（計画 D4）
 */
export async function routeSpikeDem(context: BrowserContext): Promise<void> {
  const cors = { 'access-control-allow-origin': '*' }
  await context.route('https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/17/**', (route) => {
    const match = /\/(\d+)\/(\d+)\.png$/.exec(new URL(route.request().url()).pathname)
    const file = match === null ? null : new URL(`dem1a-17-${match[1]}-${match[2]}.png`, demDir)
    if (file === null || !existsSync(file)) {
      return route.fulfill({ status: 404, headers: cors, body: 'not found' })
    }
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: cors,
      body: readFileSync(file),
    })
  })
}

/**
 * 地理院への要求を差し替えてページを開き、準備ができるまで待つ。ページのエラーを集める配列を返す。
 * 配列は後のエラーも受け取り続けるので、呼び出し側は参照を持ち、最後に確かめる（1 回だけ展開して写さない。P20）
 */
export async function openSpike(
  page: Page,
  context: BrowserContext,
  query: Record<string, string | number>,
): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await routeGsi(context)
  await routeSpikeDem(context)
  await page.goto(spikeQuery(query))
  await expect(page.locator('html[data-spike-ready="true"]')).toBeAttached({ timeout: 120_000 })
  return errors
}

export async function setView(page: Page, view: View): Promise<void> {
  await page.evaluate(async (v) => {
    await window.spike?.setView(v)
  }, view)
}
