import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { CanvasRenderer } from './Renderer'
import { InputController } from './InputController'
import type { InputBridge } from './InputController'
import type { NotebookDoc } from '../documents/DocumentModel'

/** App-side bridge: InputBridge plus the renderer/canvas slots wired on mount. */
export type AppBridge = InputBridge & {
  renderer: CanvasRenderer | null
  /** The host canvas element; the bridge reads its rect for input mapping. */
  canvas: HTMLCanvasElement | null
}

export interface WhiteboardCanvasProps {
  /** Stable mutable bridge; App keeps its fields fresh on every render. */
  bridge: AppBridge
  notebook: NotebookDoc | null
  pageId: string
}

/**
 * The canvas host. Owns the renderer and input controller lifecycle; the two
 * engine objects live entirely outside React state. High-frequency input and
 * rAF rendering never touch the React tree.
 */
export function WhiteboardCanvas({ bridge, notebook, pageId }: WhiteboardCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)
  const inputRef = useRef<InputController | null>(null)

  // Engine lifecycle (mount once).
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const renderer = new CanvasRenderer(canvas)
    const input = new InputController(canvas, bridge)
    rendererRef.current = renderer
    inputRef.current = input
    bridge.renderer = renderer
    bridge.canvas = canvas

    const applySize = () => {
      const rect = wrap.getBoundingClientRect()
      renderer.setViewport(Math.max(1, rect.width), Math.max(1, rect.height), window.devicePixelRatio || 1)
    }
    applySize()

    const ro = new ResizeObserver(applySize)
    ro.observe(wrap)
    const onWinResize = () => applySize()
    window.addEventListener('resize', onWinResize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWinResize)
      input.destroy()
      renderer.destroy()
      rendererRef.current = null
      inputRef.current = null
      bridge.renderer = null
      bridge.canvas = null
    }
    // `bridge` is a stable ref object; it must not re-run this effect.
  }, [bridge])

  // Document changes (from the controller) and page switches.
  useEffect(() => {
    rendererRef.current?.setNotebook(notebook, pageId)
  }, [notebook, pageId])

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <canvas
        ref={canvasRef}
        className="whiteboard-canvas"
        // Gestures are handled by the input controller; only the drawing
        // surface opts out of browser touch actions (brief §5).
        style={{ touchAction: 'none' }}
        aria-label="Whiteboard drawing canvas. Use the toolbar to switch tools."
        role="img"
      />
    </div>
  )
}
