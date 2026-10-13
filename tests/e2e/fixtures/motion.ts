import { expect, type Page } from '@playwright/test'

export async function settled(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => !document.querySelector('[data-motion-running]') && !document.getAnimations().some(animation => animation.playState === 'running')), { timeout: 5000 }).toBe(true)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

export async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => {
    const native = window.requestAnimationFrame.bind(window)
    const queued: FrameRequestCallback[] = []
    window.requestAnimationFrame = callback => { queued.push(callback); return queued.length }
    ;(window as Window & { resumeMotion: () => void }).resumeMotion = () => {
      window.requestAnimationFrame = native
      queued.forEach(callback => native(callback))
    }
  })
  await page.waitForTimeout(40)
}

export async function resume(page: Page): Promise<void> {
  await page.evaluate(() => (window as Window & { resumeMotion: () => void }).resumeMotion())
}
