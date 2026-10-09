import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// jsdom has no ResizeObserver; WhiteboardCanvas needs one at mount.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// jsdom returns null for 2d contexts; give every canvas a no-op context so
// renderer/export code paths can run under test.
function makeContext2dStub(): CanvasRenderingContext2D {
  const noop = (): void => {}
  return {
    canvas: null,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    stroke: noop,
    fill: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    drawImage: noop,
    setTransform: noop,
    transform: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    resetTransform: noop,
    setLineDash: noop,
    clip: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    measureText: () => ({ width: 0 }),
  } as unknown as CanvasRenderingContext2D
}
;(HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D | null }).getContext =
  () => makeContext2dStub()

// Rendering insurance in case rAF is missing in some environments.
if (typeof window.requestAnimationFrame === 'undefined') {
  window.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
    window.setTimeout(() => cb(Date.now()), 16)) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number): void => window.clearTimeout(id)) as typeof window.cancelAnimationFrame
}

afterEach(() => {
  cleanup()
})
