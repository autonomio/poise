// The time zone every Poise time is shown in (src/config.ts): the one saved in
// Settings when this browser knows it, and the browser's own otherwise, with
// an unknown saved one named so the page can say so.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectiveTimezone, getSettings, setLocalSettings, unknownSavedTimezone, type AppSettings } from '../src/config'

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
let saved: AppSettings

beforeEach(() => { saved = getSettings() })
afterEach(() => setLocalSettings(saved))

describe('the time zone times are shown in', () => {
  it('is the saved one when this browser knows it', () => {
    setLocalSettings({ org: '', me: '', timezone: 'Europe/Helsinki' })
    expect(effectiveTimezone()).toBe('Europe/Helsinki')
    expect(unknownSavedTimezone()).toBeNull()
  })

  it("is the browser's own when the saved one is unknown, which is named", () => {
    setLocalSettings({ org: '', me: '', timezone: 'Mars/Olympus' })
    expect(effectiveTimezone()).toBe(browserZone)
    expect(unknownSavedTimezone()).toBe('Mars/Olympus')
  })

  it("is the browser's own while none is saved, with nothing to name", () => {
    setLocalSettings({ org: '', me: '', timezone: '' })
    expect(effectiveTimezone()).toBe(browserZone)
    expect(unknownSavedTimezone()).toBeNull()
  })
})
