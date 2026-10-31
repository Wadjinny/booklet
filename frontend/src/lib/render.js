import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Open PDF bytes for rendering. pdf.js takes ownership of the buffer, so pass a copy. */
export function openPdf(bytes) {
  return pdfjs.getDocument({ data: bytes.slice() }).promise
}

// Stay under the canvas area limit of mobile Safari (~16.7M px).
const MAX_PIXELS = 14e6

/**
 * Render one page into a canvas, sized for cssWidth CSS pixels times `zoom`.
 * Renders offscreen first so the visible canvas never flashes blank.
 */
export async function renderPage(doc, index, canvas, cssWidth, zoom = 1) {
  const page = await doc.getPage(index + 1)
  const base = page.getViewport({ scale: 1 })
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
  let scale = (cssWidth / base.width) * dpr * zoom
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (base.width * base.height)))
  const vp = page.getViewport({ scale })
  const tmp = document.createElement('canvas')
  tmp.width = Math.floor(vp.width)
  tmp.height = Math.floor(vp.height)
  await page.render({ canvas: tmp, canvasContext: tmp.getContext('2d'), viewport: vp }).promise
  canvas.width = tmp.width
  canvas.height = tmp.height
  canvas.style.aspectRatio = `${base.width} / ${base.height}`
  canvas.getContext('2d').drawImage(tmp, 0, 0)
  tmp.width = tmp.height = 0
}
