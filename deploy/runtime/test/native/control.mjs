// Kernel component checks use the image's actual controller, not a stand-in.
import { once } from 'node:events'
import { namespaceControl } from '/opt/poise-runtime/supervisor.mjs'

const control = await namespaceControl()
process.stdout.write(`${JSON.stringify(control.address)}\n`)
process.stdin.resume()
await once(process.stdin, 'end')
await control.close()
