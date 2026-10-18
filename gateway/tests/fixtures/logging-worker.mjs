import { parentPort } from 'node:worker_threads'
parentPort.on('message', ({ id, request }) => {
  if (request.filter.search === 'hold') return
  parentPort.postMessage({ id, reply: { status: 200, contentType: 'application/json', body: '{"version":1}' } })
})
