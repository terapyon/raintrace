import { addProtocol, type Map as MapLibreMap, type RasterDEMTileSource } from 'maplibre-gl'
import { PromiseCache } from '../../dem/async'
import type { RangeElevation } from '../../dem/terrainTiles'
import { DEM_TILE_SIZE } from '../../dem/tileZoom'
import {
  DEM_PROTOCOL,
  type DemSourceKind,
  type DemTileRequest,
  demSourceSpec,
  demTileTemplate,
  parseDemTileUrl,
} from './demSource'
import { VIEW3D_LAYER_IDS, VIEW3D_SOURCE_IDS } from './layerIds'
import type { TileTimeSample } from './options'
import type { DemTileGenerator } from './tileGenerator'

/** 組み立て済みのタイル（RGBA）の数。1 枚 256 KB で 8 MB */
const COMPLETED_TILE_CAPACITY = 32
const SOURCES = Object.keys(VIEW3D_SOURCE_IDS) as DemSourceKind[]

// addProtocol は地図の外（このモジュール）で 1 回だけ登録し、今の Terrain3d へ渡す。登録はコンテキスト喪失の
// 影響を受けない（spec 05 §3.7）。Terrain3d は View3d の破棄まで入れ替えない（3D を切っても外さない）ので、
// 取り消されずに残った要求も答えられる
let current: Terrain3d | null = null
let registered = false

function registerProtocol(): void {
  if (registered) return
  registered = true
  addProtocol(DEM_PROTOCOL, async (request, abortController) => {
    const parsed = parseDemTileUrl(request.url)
    const terrain = current
    if (parsed === null || terrain === null) {
      throw new Error(`地形のタイルの要求を扱えません: ${request.url}`)
    }
    return { data: await terrain.tile(parsed, abortController.signal) }
  })
}

/**
 * MapLibre の 3D terrain（方式 A。spec 05 §4.1・§4.2）。raster-dem のソース 2 つ（地形と hillshade）と
 * setTerrain を持つ。追加はどれも冪等（無いものだけ足す）なので、ベースマップの切り替えとコンテキストの復帰の後に
 * そのまま呼び直せる（計画で決めたこと 19）
 */
export class Terrain3d {
  private readonly map: MapLibreMap
  private readonly generator: DemTileGenerator
  private readonly onTileTime: ((sample: TileTimeSample) => void) | null
  /** 組み立て済みのタイル。同じタイル（世代・z・x・y）の再要求に使い回す（計画で決めたこと 24） */
  private readonly completed = new PromiseCache<Uint8ClampedArray<ArrayBuffer>>(
    COMPLETED_TILE_CAPACITY,
  )
  private exaggeration: number
  private generation = 0
  private range: RangeElevation | null = null

  constructor(
    map: MapLibreMap,
    generator: DemTileGenerator,
    exaggeration: number,
    onTileTime: ((sample: TileTimeSample) => void) | null,
  ) {
    this.map = map
    this.generator = generator
    this.exaggeration = exaggeration
    this.onTileTime = onTileTime
    current = this
    registerProtocol()
  }

  /** addProtocol の 1 回の要求に答える */
  async tile(request: DemTileRequest, signal: AbortSignal): Promise<ImageBitmap> {
    const { tile } = request
    const key = `${request.generation}/${tile.z}/${tile.x}/${tile.y}`
    let fresh = false
    const generate = async (): Promise<Uint8ClampedArray<ArrayBuffer>> => {
      fresh = true
      const generated = await this.generator.generate(tile, signal)
      // 取り消された（MapLibre が要らなくした）。MapLibre は取り消した要求の失敗を無視する
      if (generated === null) throw new Error('取り消された地形のタイル')
      this.onTileTime?.({ source: request.source, composeMs: generated.composeMs, cached: false })
      return generated.rgba
    }
    let rgba: Uint8ClampedArray<ArrayBuffer>
    try {
      rgba = await this.completed.load(key, generate)
    } catch (error) {
      // 同じタイルを先に要求した別の要求が取り消された。こちらは取り消されていないので作り直す
      if (signal.aborted || fresh) throw error
      rgba = await generate()
    }
    if (!fresh) this.onTileTime?.({ source: request.source, composeMs: 0, cached: true })
    // 共有の待ち（completed.load）の間に、この要求だけが取り消されていることがある（他の要求がまだ
    // 待っている、または既に組み立て済みだったため rgba は得られた）。ここで止める（minor 1）
    if (signal.aborted) throw new Error('取り消された地形のタイル')
    return createImageBitmap(new ImageData(rgba, DEM_TILE_SIZE, DEM_TILE_SIZE), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
  }

  /** 範囲（地形）が変わったら、世代を進めてソースのタイルを読み直させる。同じ範囲なら何もしない */
  setRange(range: RangeElevation | null): void {
    if (range === this.range) return
    this.range = range
    this.generator.setRange(range)
    this.generation++
    for (const source of SOURCES) {
      this.map
        .getSource<RasterDEMTileSource>(VIEW3D_SOURCE_IDS[source])
        ?.setTiles([demTileTemplate(source, this.generation)])
    }
  }

  /** ソース・hillshade・地形を足す（冪等）。hillshade は beforeId の前（04 の重ね描きの下）に置く */
  show(options: { hillshade: boolean; beforeId: string | undefined }): void {
    const { map } = this
    for (const source of SOURCES) {
      const id = VIEW3D_SOURCE_IDS[source]
      if (map.getSource(id) === undefined) map.addSource(id, demSourceSpec(source, this.generation))
    }
    const hasHillshade = map.getLayer(VIEW3D_LAYER_IDS.hillshade) !== undefined
    if (options.hillshade && !hasHillshade) {
      map.addLayer(
        {
          id: VIEW3D_LAYER_IDS.hillshade,
          type: 'hillshade',
          source: VIEW3D_SOURCE_IDS.hillshade,
          // 光の向きを地図に固定する（視点を回しても陰が変わらない）
          paint: { 'hillshade-exaggeration': 0.5, 'hillshade-illumination-anchor': 'map' },
        },
        options.beforeId,
      )
    } else if (!options.hillshade && hasHillshade) {
      map.removeLayer(VIEW3D_LAYER_IDS.hillshade)
    }
    const terrain = map.getTerrain()
    if (
      terrain?.source !== VIEW3D_SOURCE_IDS.terrain ||
      terrain.exaggeration !== this.exaggeration
    ) {
      map.setTerrain({ source: VIEW3D_SOURCE_IDS.terrain, exaggeration: this.exaggeration })
    }
  }

  /** 垂直強調（spec 05 §3.2。水面のシェーダにも同じ値を渡す。Task 8） */
  setExaggeration(value: number): void {
    this.exaggeration = value
    if (this.map.getTerrain() !== null) {
      this.map.setTerrain({ source: VIEW3D_SOURCE_IDS.terrain, exaggeration: value })
    }
  }

  /** 地形・hillshade・ソースを外す（2D、または 2D に落ちたとき）。地形を先に外す（使っているソースは消せない） */
  hide(): void {
    const { map } = this
    if (map.getTerrain() !== null) map.setTerrain(null)
    if (map.getLayer(VIEW3D_LAYER_IDS.hillshade) !== undefined) {
      map.removeLayer(VIEW3D_LAYER_IDS.hillshade)
    }
    for (const source of SOURCES) {
      const id = VIEW3D_SOURCE_IDS[source]
      if (map.getSource(id) !== undefined) map.removeSource(id)
    }
  }

  dispose(): void {
    this.generator.dispose()
    if (current === this) current = null
  }
}
