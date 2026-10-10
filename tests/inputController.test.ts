import { describe, expect, it, vi } from 'vitest'
import { InputController } from '../src/canvas/InputController'
import type { InputBridge, InkStyle } from '../src/canvas/InputController'
import type { ViewTransform } from '../src/canvas/CoordinateSystem'

/**
 * Regression tests for the pointer gesture state machine, focused on the
 * pinch → pan transition and pointer lifecycle (task brief §4 Issue A and
 * §9 items 1–3).
 *
 * jsdom has no PointerEvent constructor and no setPointerCapture, so events
 * are plain Events carrying pointer fields, and capture is stubbed.
 */

interface FireInit {
  pointerId: number
  x: number
  y: number
  shiftKey?: boolean
}

function fire(canvas: HTMLCanvasElement, type: string, init: FireInit): void {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(ev, {
    pointerId: init.pointerId,
    clientX: init.x,
    clientY: init.y,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    shiftKey: init.shiftKey ?? false,
  })
  canvas.dispatchEvent(ev as unknown as PointerEvent)
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  ;(c as unknown as Record<string, unknown>).setPointerCapture = vi.fn()
  return c
}

function makeBridge() {
  const view: ViewTransform = { zoom: 1, panX: 0, panY: 0 }
  const flags = { navigate: false, space: false }
  const calls = {
    panBy: vi.fn(),
    zoomAt: vi.fn(),
    beginStroke: vi.fn(),
    extendStroke: vi.fn(),
    endStroke: vi.fn(),
    cancelStroke: vi.fn(),
    beginErase: vi.fn(),
    endErase: vi.fn(),
    cancelErase: vi.fn(),
  }
  const bridge = {
    getTool: () => 'pen' as const,
    getStyle: (): InkStyle => ({ color: '#000000', width: 3, smoothing: 'balanced' }),
    isInkTool: () => true,
    isNavigateMode: () => flags.navigate,
    isSpacePanning: () => flags.space,
    shouldIgnoreExtraContacts: () => true,
    isSnapEnabled: () => false,
    getGridSize: () => 0,
    getView: () => view,
    getCanvasRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    panBy: calls.panBy,
    zoomAt: calls.zoomAt,
    beginStroke: calls.beginStroke,
    extendStroke: calls.extendStroke,
    endStroke: calls.endStroke,
    cancelStroke: calls.cancelStroke,
    beginErase: calls.beginErase,
    moveErase: vi.fn(),
    endErase: calls.endErase,
    cancelErase: calls.cancelErase,
    beginTextMarquee: vi.fn(),
    updateTextMarquee: vi.fn(),
    endTextMarquee: vi.fn(),
    selectAt: vi.fn(() => false),
    beginMove: vi.fn(),
    moveBy: vi.fn(),
    endMove: vi.fn(),
    updateCursor: vi.fn(),
  }
  return { bridge: bridge as unknown as InputBridge, calls, flags }
}

/** Standard two-finger pinch setup; returns after the pinch has begun. */
function startPinch(canvas: HTMLCanvasElement): void {
  fire(canvas, 'pointerdown', { pointerId: 1, x: 100, y: 100 })
  fire(canvas, 'pointerdown', { pointerId: 2, x: 260, y: 120 })
}

describe('InputController gesture lifecycle', () => {
  it('pans incrementally after a pinch partner lifts (pointer-up transition, no jump)', () => {
    const { bridge, calls, flags } = makeBridge()
    flags.navigate = true
    const canvas = makeCanvas()
    const ctrl = new InputController(canvas, bridge)

    startPinch(canvas)
    fire(canvas, 'pointermove', { pointerId: 2, x: 460, y: 120 })
    fire(canvas, 'pointermove', { pointerId: 2, x: 470, y: 125 })
    fire(canvas, 'pointerup', { pointerId: 1, x: 100, y: 100 })

    // The surviving pointer's last known position (470, 125) is the new pan
    // reference: the next move must produce only its incremental delta.
    calls.panBy.mockClear()
    fire(canvas, 'pointermove', { pointerId: 2, x: 476, y: 129 })
    expect(calls.panBy).toHaveBeenCalledTimes(1)
    expect(calls.panBy).toHaveBeenCalledWith(6, 4)

    // A late lostpointercapture for the lifted pointer must not disturb the
    // new pan (browsers release the old capture asynchronously).
    canvas.dispatchEvent(
      Object.assign(new Event('lostpointercapture'), { pointerId: 1 }) as unknown as PointerEvent,
    )
    fire(canvas, 'pointermove', { pointerId: 2, x: 480, y: 135 })
    expect(calls.panBy).toHaveBeenLastCalledWith(4, 6)

    // The surviving pointer gains capture so panning survives edge drift.
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(2)
    ctrl.destroy()
  })

  it('pans incrementally after a pinch partner is cancelled (pointer-cancel transition)', () => {
    const { bridge, calls, flags } = makeBridge()
    flags.navigate = true
    const canvas = makeCanvas()
    const ctrl = new InputController(canvas, bridge)

    startPinch(canvas)
    fire(canvas, 'pointermove', { pointerId: 2, x: 460, y: 120 })
    fire(canvas, 'pointercancel', { pointerId: 1, x: 100, y: 100 })

    calls.panBy.mockClear()
    fire(canvas, 'pointermove', { pointerId: 2, x: 470, y: 130 })
    expect(calls.panBy).toHaveBeenCalledTimes(1)
    expect(calls.panBy).toHaveBeenCalledWith(10, 10)
    ctrl.destroy()
  })

  it('returns to a clean idle after all pointers lift and starts the next gesture fresh', () => {
    const { bridge, calls, flags } = makeBridge()
    flags.navigate = true
    const canvas = makeCanvas()
    const ctrl = new InputController(canvas, bridge)

    startPinch(canvas)
    fire(canvas, 'pointerup', { pointerId: 1, x: 100, y: 100 })
    fire(canvas, 'pointerup', { pointerId: 2, x: 460, y: 120 })

    // A brand-new single pointer pans from its own down position.
    fire(canvas, 'pointerdown', { pointerId: 3, x: 200, y: 200 })
    fire(canvas, 'pointermove', { pointerId: 3, x: 210, y: 205 })
    expect(calls.panBy).toHaveBeenCalledTimes(1)
    expect(calls.panBy).toHaveBeenCalledWith(10, 5)
    ctrl.destroy()
  })

  it('zooms around the pinch midpoint, ignores a third contact, and never pans on the first pinch move', () => {
    const { bridge, calls, flags } = makeBridge()
    flags.navigate = true
    const canvas = makeCanvas()
    const ctrl = new InputController(canvas, bridge)

    startPinch(canvas)
    // First move after pinch start has no running distance yet: no zoom, no pan.
    fire(canvas, 'pointermove', { pointerId: 2, x: 460, y: 120 })
    expect(calls.zoomAt).not.toHaveBeenCalled()
    expect(calls.panBy).not.toHaveBeenCalled()

    // A third contact during the pinch is neither rejected nor disruptive.
    expect(() =>
      fire(canvas, 'pointerdown', { pointerId: 3, x: 50, y: 50 }),
    ).not.toThrow()

    fire(canvas, 'pointermove', { pointerId: 2, x: 560, y: 120 })
    expect(calls.zoomAt).toHaveBeenCalledTimes(1)
    const [mid, factor] = calls.zoomAt.mock.calls[0] as [{ x: number; y: number }, number]
    expect(mid).toEqual({ x: 330, y: 110 })
    expect(factor).toBeGreaterThan(1.2)
    expect(factor).toBeLessThan(1.35)
    ctrl.destroy()
  })

  it('ignores an extra contact while drawing and finishes only the primary stroke', () => {
    const { bridge, calls } = makeBridge()
    const canvas = makeCanvas()
    const ctrl = new InputController(canvas, bridge)

    fire(canvas, 'pointerdown', { pointerId: 1, x: 10, y: 10 })
    fire(canvas, 'pointermove', { pointerId: 1, x: 20, y: 12 })
    fire(canvas, 'pointerdown', { pointerId: 2, x: 30, y: 30 }) // resting palm
    expect(calls.beginStroke).toHaveBeenCalledTimes(1)
    expect(calls.extendStroke).toHaveBeenCalled()

    fire(canvas, 'pointerup', { pointerId: 1, x: 22, y: 13 })
    expect(calls.endStroke).toHaveBeenCalledTimes(1)

    // The ignored contact lifting afterwards must not commit anything new.
    fire(canvas, 'pointerup', { pointerId: 2, x: 30, y: 30 })
    expect(calls.endStroke).toHaveBeenCalledTimes(1)
    ctrl.destroy()
  })

  it('cancels the in-progress stroke on pointercancel instead of committing it', () => {
    const { bridge, calls } = makeBridge()
    const canvas = makeCanvas()
    const ctrl = new InputController(canvas, bridge)

    fire(canvas, 'pointerdown', { pointerId: 1, x: 10, y: 10 })
    fire(canvas, 'pointermove', { pointerId: 1, x: 40, y: 40 })
    fire(canvas, 'pointercancel', { pointerId: 1, x: 40, y: 40 })
    expect(calls.cancelStroke).toHaveBeenCalledTimes(1)
    expect(calls.endStroke).not.toHaveBeenCalled()

    // The controller accepts a new gesture afterwards.
    fire(canvas, 'pointerdown', { pointerId: 2, x: 5, y: 5 })
    expect(calls.beginStroke).toHaveBeenCalledTimes(2)
    ctrl.destroy()
  })
})
