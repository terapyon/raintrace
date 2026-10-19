/**
 * 崩れた土砂の粒の経路・到達・堆積（spec 10 §3.2 の部品 1〜3）。Wichmann 2017（GMD 10:3309）の論文の式と
 * 手順だけから書いた（クリーンルーム、R10-1）。到達は PCM（Perla–Cheng–McClung）の速度の式を使う。
 *
 * - 崩れた跡の地形 = elevation − removed。粒の通り道の高さは「崩れた跡 + それまでに積もった厚さ」なので、
 *   後の粒は先の粒が積もった上を通る（せき止めができる。R10-2）
 * - 範囲の外・無効なセルへ進んだ粒は outsideM3 に数える。外の高さは、今のセルと反対側の隣を結んだ直線を
 *   のばして決める（反対側も外なら今のセルと同じ高さとみなし、そちらへは進まない）。論文に無い RainTrace の決め方
 * - 速さが 0 になった歩では、その歩で入ったセルに積む（論文に無い RainTrace の決め方）
 * - 経路の候補は論文の式 2〜5（Gamma 2000 の方法）: γᵢ = tanβᵢ / tanβthres。γmax > 1 なら最急の近傍だけ、
 *   そうでなければ γᵢ ≥ γmax^a の近傍（a = divergence）。候補から f·tanβ に比例する確率で選ぶ（f は前と
 *   同じ向きなら persistence、それ以外は 1）
 * - 同じ高さの近傍へは進まない。論文は平らな所で、まだ通っていない同じ高さのセルへ進むことを許すが、
 *   RainTrace では許さない（裁定 R5）
 * - 到達は論文の式 13〜16・18〜19: L は斜面に沿った長さ（水平の長さ / cosθ）。凹の折れ目（前の歩の角度 ≥
 *   今の歩の角度）では前の速さに cos(θᵢ₋₁ − θᵢ) をかける。粒は初速 initialVelocityMS で出る
 */
import { DEBRIS_BULKING, GRAVITY, PARTICLES_PER_CELL } from './constants.ts'
import { createRandom } from './random.ts'

/** 土砂の流れやすさのパラメータ。src/shared/debrisPresets.ts の DebrisParams と同じ形（simulation は shared を import できない） */
export interface DebrisParams {
  /** PCM の摩擦係数 μ */
  mu: number
  /** PCM の質量と抗力の比 M/D（m） */
  massToDragM: number
  /** ランダムウォークの発散の指数 a。大きいほど横へ広がる */
  divergence: number
  /** 同じ向きに進み続ける重み */
  persistence: number
  /** 積もった土の斜面の限界の角度（度。Task 3 の形を整える部品で使う） */
  reposeDeg: number
  /** ランダムウォークの斜面の閾値 βthres（度）。これより急なら最急の近傍だけへ進む */
  slopeThresholdDeg: number
  /** 粒の最初の速さ（m/s） */
  initialVelocityMS: number
}

/** 正方形のグリッド（size × size、行優先、北が 0 行目） */
export interface DebrisGrid {
  elevation: Float32Array
  validMask: Uint8Array
  size: number
  cellSizeM: number
}

export interface RunoutResult {
  /** 積もった厚さ（m） */
  deposit: Float32Array
  /** 崩れた土の体積（m³。有効なセルの removed の合計 × セルの面積） */
  collapsedM3: number
  /** 積もった土の体積（m³。deposit の合計 × セルの面積） */
  depositedM3: number
  /** 範囲の外・無効なセルへ出た量（m³） */
  outsideM3: number
}

/** 8 近傍（北西・北・北東・西・東・南西・南・南東） */
const DR = [-1, -1, -1, 0, 0, 1, 1, 1]
const DC = [-1, 0, 1, -1, 1, -1, 0, 1]
/** 反対の向きの添字 */
const OPPOSITE = [7, 6, 5, 4, 3, 2, 1, 0]

/**
 * PCM の 1 歩の速さの 2 乗。v² = α·(M/D)·(1 − e^β) + v*²·e^β、α = g(sinθ − μcosθ)、β = −2L / (M/D)、
 * L = 水平の長さ / cosθ。凹の折れ目（prevTheta ≥ theta）では v* = v·cos(prevTheta − theta)、それ以外は v* = v。
 * prevTheta が NaN（最初の歩）なら落とさない。角度はラジアン
 */
export function pcmVelocitySq(
  prevV2: number,
  prevTheta: number,
  theta: number,
  horizontalM: number,
  params: Pick<DebrisParams, 'mu' | 'massToDragM'>,
): number {
  const { mu, massToDragM } = params
  const cos = Math.cos(theta)
  const alpha = GRAVITY * (Math.sin(theta) - mu * cos)
  const eb = Math.exp((-2 * horizontalM) / cos / massToDragM)
  let v2 = prevV2
  if (prevTheta >= theta) {
    const k = Math.cos(prevTheta - theta)
    v2 *= k * k
  }
  return alpha * massToDragM * (1 - eb) + v2 * eb
}

export function runout(
  grid: DebrisGrid,
  removed: Float32Array,
  params: DebrisParams,
  seed: number,
): RunoutResult {
  const { elevation, validMask, size, cellSizeM } = grid
  const n = size * size
  const cellArea = cellSizeM * cellSizeM
  const { divergence, persistence } = params
  const tanThreshold = Math.tan((params.slopeThresholdDeg * Math.PI) / 180)
  const initialV2 = params.initialVelocityMS * params.initialVelocityMS
  const random = createRandom(seed)
  const maxSteps = 4 * size

  // 通り道の高さ（崩れた跡 + 積もった厚さ）と、積もった厚さ。和の誤差を抑えるため倍精度で持つ
  const surface = new Float64Array(n)
  const depositAcc = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = removed[i] ?? 0
    if (validMask[i] !== 0) surface[i] = elevation[i] - (!(t > 0) ? 0 : t)
  }

  // 向きごとの 1 歩の水平の長さ
  const stepLength = new Float64Array(8)
  for (let k = 0; k < 8; k++) {
    stepLength[k] = DR[k] !== 0 && DC[k] !== 0 ? Math.SQRT2 * cellSizeM : cellSizeM
  }
  // 1 歩ごとの作業用（割り当てをくり返さない）
  const weight = new Float64Array(8)
  const tanSlope = new Float64Array(8)
  const target = new Int32Array(8)

  /** (r, c) が範囲の中の有効なセルなら添字、そうでなければ −1 */
  const indexOf = (r: number, c: number): number => {
    if (r < 0 || r >= size || c < 0 || c >= size) return -1
    const i = r * size + c
    return validMask[i] !== 0 ? i : -1
  }

  let collapsedM3 = 0
  let outsideM3 = 0

  for (let source = 0; source < n; source++) {
    const t = removed[source]
    if (validMask[source] === 0 || !(t > 0)) continue
    collapsedM3 += t * cellArea
    const particleM3 = (t * cellArea * DEBRIS_BULKING) / PARTICLES_PER_CELL
    const particleThickness = particleM3 / cellArea

    for (let p = 0; p < PARTICLES_PER_CELL; p++) {
      let cur = source
      let v2 = initialV2
      let prevDir = -1
      let prevTheta = Number.NaN
      let escaped = false

      for (let step = 0; step < maxSteps; step++) {
        const r = Math.floor(cur / size)
        const c = cur - r * size
        const h = surface[cur]

        // 経路: 今より低い近傍の tanβ を求める（同じ高さへは進まない。R5）
        let tanMax = 0
        for (let k = 0; k < 8; k++) {
          tanSlope[k] = 0
          const j = indexOf(r + DR[k], c + DC[k])
          target[k] = j
          let hn: number
          if (j >= 0) {
            hn = surface[j]
          } else {
            const o = OPPOSITE[k]
            const jo = indexOf(r + DR[o], c + DC[o])
            hn = jo >= 0 ? 2 * h - surface[jo] : h
          }
          const drop = h - hn
          if (!(drop > 0)) continue
          const tan = drop / stepLength[k]
          tanSlope[k] = tan
          if (tan > tanMax) tanMax = tan
        }
        if (tanMax <= 0) break // 低い近傍が無い

        // 候補（式 2〜5）: γmax > 1 なら最急だけ、そうでなければ γᵢ ≥ γmax^a。重みは f·tanβ
        const gammaMax = tanMax / tanThreshold
        // 最急の近傍は必ず候補に入る（a = 1 のとき γmax^a·tanβthres が丸めで tanMax を超えないように min をとる）
        const minTan =
          gammaMax > 1 ? tanMax : Math.min(tanMax, gammaMax ** divergence * tanThreshold)
        let total = 0
        for (let k = 0; k < 8; k++) {
          const tan = tanSlope[k]
          weight[k] = 0
          if (!(tan > 0) || tan < minTan) continue
          const w = k === prevDir ? tan * persistence : tan
          weight[k] = w
          total += w
        }

        let pick = random() * total
        let dir = -1
        for (let k = 0; k < 8; k++) {
          if (weight[k] <= 0) continue
          dir = k
          pick -= weight[k]
          if (pick < 0) break
        }
        if (dir < 0) break // 向きが選べなかった（起きないはずの守り）。今のセルに積む

        const next = target[dir]
        if (next < 0) {
          escaped = true
          break
        }

        // 到達（PCM）
        const theta = Math.atan(tanSlope[dir])
        v2 = pcmVelocitySq(v2, prevTheta, theta, stepLength[dir], params)
        prevTheta = theta
        cur = next
        prevDir = dir
        if (v2 <= 0) break
      }

      if (escaped) {
        outsideM3 += particleM3
      } else {
        // 堆積: 止まったセルに積む。後の粒はこの上を通る
        surface[cur] += particleThickness
        depositAcc[cur] += particleThickness
      }
    }
  }

  const deposit = new Float32Array(n)
  let depositedM3 = 0
  for (let i = 0; i < n; i++) {
    if (depositAcc[i] === 0) continue
    deposit[i] = depositAcc[i]
    depositedM3 += deposit[i] * cellArea
  }

  return { deposit, collapsedM3, depositedM3, outsideM3 }
}
