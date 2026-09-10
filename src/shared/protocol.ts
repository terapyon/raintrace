/**
 * メインスレッドと Worker の間のメッセージ（tech-spec §5）。判別可能な union 型で、02 以降で種類を足す
 */

export type MainToWorkerMessage = { type: 'ping'; id: number }

export type WorkerToMainMessage = { type: 'pong'; id: number }
