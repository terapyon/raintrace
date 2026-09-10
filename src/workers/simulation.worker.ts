import type { MainToWorkerMessage, WorkerToMainMessage } from '../shared/protocol'

declare const self: DedicatedWorkerGlobalScope

function post(message: WorkerToMainMessage): void {
  self.postMessage(message)
}

self.addEventListener('message', (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data
  switch (message.type) {
    case 'ping':
      post({ type: 'pong', id: message.id })
      break
  }
})
