import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
} from 'pdf-lib'
import { MM, plan } from './plan.js'

const TONES = { light: 0.72, gray: 0.5, black: 0 }

/** Load a PDF once; returns the document and each page's displayed size. */
export async function loadSource(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pages = doc.getPages().map((p) => {
    const box = p.getCropBox()
    const rot = ((p.getRotation().angle % 360) + 360) % 360
    const quarter = rot === 90 || rot === 270
    return { w: quarter ? box.height : box.width, h: quarter ? box.width : box.height, rot, box }
  })
  return { doc, pages }
}

function rotVec(x, y, deg) {
  const a = (deg * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}

/** Map a point given in the cell's upright local frame to page coordinates. */
function toPage(cell, lx, ly) {
  return cell.rot === 180 ? [cell.x + cell.w - lx, cell.y + cell.h - ly] : [cell.x + lx, cell.y + ly]
}

/** Local content box of a cell after margins, spine margin and creep. */
function contentBox(cell, o) {
  const m = o.margin * MM
  const spine = o.spineMargin * MM
  const creep = o.creep * MM * cell.strip.inBooklet
  // 'L' pages have the fold on their right, 'R' pages on their left.
  const left = m + (cell.side === 'R' ? spine : 0)
  const right = m + (cell.side === 'L' ? spine : 0)
  const shift = cell.side === 'L' ? creep : -creep
  return {
    x: left + shift,
    y: m,
    w: Math.max(1, cell.w - left - right),
    h: Math.max(1, cell.h - 2 * m),
  }
}

function drawSourcePage(page, cell, emb, src, o) {
  const b = contentBox(cell, o)
  let dw = src.w
  let dh = src.h
  let extra = 0
  if (o.autoRotate && dw > dh !== b.w > b.h && Math.abs(dw - dh) > 1) {
    extra = 90
    ;[dw, dh] = [dh, dw]
  }
  // Rotation applied to the raw (unrotated) embedded page, counter-clockwise.
  const theta = (((cell.rot + extra - src.rot) % 360) + 360) % 360
  const quarter = theta === 90 || theta === 270

  let sx
  let sy
  if (o.fit === 'stretch') {
    sx = (quarter ? b.h : b.w) / emb.width
    sy = (quarter ? b.w : b.h) / emb.height
  } else {
    const s =
      o.fit === 'cover'
        ? Math.max(b.w / dw, b.h / dh)
        : o.fit === 'actual'
          ? 1
          : Math.min(b.w / dw, b.h / dh)
    sx = sy = s
  }
  const w = emb.width * sx
  const h = emb.height * sy
  const [cx, cy] = toPage(cell, b.x + b.w / 2, b.y + b.h / 2)
  const [ox, oy] = rotVec(w / 2, h / 2, theta)

  // Clip to the content box so cover/actual never bleed into neighbours.
  const [x1, y1] = toPage(cell, b.x, b.y)
  const [x2, y2] = toPage(cell, b.x + b.w, b.y + b.h)
  page.pushOperators(
    pushGraphicsState(),
    rectangle(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)),
    clip(),
    endPath(),
  )
  page.drawPage(emb, { x: cx - ox, y: cy - oy, xScale: sx, yScale: sy, rotate: degrees(theta) })
  page.pushOperators(popGraphicsState())
}

function drawNumber(page, cell, o, font) {
  if (!o.numbers) return
  if (cell.page === null && !o.numberBlanks) return
  if (o.numberSkipFirst && cell.seqPos === 0) return
  const text = String(cell.seqPos + o.numberStart)
  const size = o.numberSize
  const tw = font.widthOfTextAtSize(text, size)
  const inset = Math.max(2.5 * MM, o.margin * MM * 0.5)
  const [vert, horiz] = o.numberPos.split('-')
  const outerIsLeft = cell.side === 'L'
  let lx = (cell.w - tw) / 2
  if (horiz === 'outer') lx = outerIsLeft ? inset + o.margin * MM * 0.3 : cell.w - inset - tw - o.margin * MM * 0.3
  const ly = vert === 'top' ? cell.h - inset - size * 0.75 : inset
  const [x, y] = toPage(cell, lx, ly)
  page.drawText(text, { x, y, size, font, color: rgb(0.15, 0.15, 0.15), rotate: degrees(cell.rot) })
}

function drawMarks(page, p, sheetIdx, side, o, font, bold) {
  const tone = TONES[o.markTone] ?? 0.5
  const color = rgb(tone, tone, tone)
  const { W, H, cols, rows, cellW, cellH, sheetMargin: sm } = p
  const isFront = side === 'front'
  const showLines = isFront || o.marksBothSides
  const tick = Math.max(2 * MM, sm - 1 * MM)

  if (o.cutLines && showLines) {
    const xs = []
    for (let c = 0; c <= cols; c += 2) xs.push(sm + c * cellW)
    const ys = []
    for (let r = 0; r <= rows; r++) ys.push(sm + r * cellH)
    const dashed = { thickness: 0.5, color, dashArray: [4, 3] }
    const solid = { thickness: 0.5, color }
    for (const x of xs) {
      if (o.cutStyle === 'dashed') page.drawLine({ start: { x, y: 0 }, end: { x, y: H }, ...dashed })
      else {
        page.drawLine({ start: { x, y: 0 }, end: { x, y: tick }, ...solid })
        page.drawLine({ start: { x, y: H - tick }, end: { x, y: H }, ...solid })
      }
    }
    for (const y of ys) {
      if (o.cutStyle === 'dashed') page.drawLine({ start: { x: 0, y }, end: { x: W, y }, ...dashed })
      else {
        page.drawLine({ start: { x: 0, y }, end: { x: tick, y }, ...solid })
        page.drawLine({ start: { x: W - tick, y }, end: { x: W, y }, ...solid })
      }
    }
  }

  if (o.foldLines && showLines) {
    for (let c = 1; c < cols; c += 2) {
      const x = sm + c * cellW
      for (let r = 0; r < rows; r++) {
        const y0 = sm + r * cellH
        page.drawLine({
          start: { x, y: y0 + 1.5 * MM },
          end: { x, y: y0 + cellH - 1.5 * MM },
          thickness: 0.4,
          color,
          dashArray: [1, 2.5],
          opacity: 0.8,
        })
      }
      // fold ticks in the margin so they survive even with lines inside hidden
      page.drawLine({ start: { x, y: 0 }, end: { x, y: Math.min(tick, sm * 0.6) }, thickness: 0.4, color })
      page.drawLine({ start: { x, y: H - Math.min(tick, sm * 0.6) }, end: { x, y: H }, thickness: 0.4, color })
    }
  }

  if (o.stackNumbers && isFront) {
    const multi = p.booklets.length > 1
    for (const s of p.sheets[sheetIdx].strips) {
      const label = multi ? `B${s.booklet + 1}-${s.inBooklet + 1}` : `#${s.stackNo}`
      const size = 5.5
      const tw = bold.widthOfTextAtSize(label, size)
      const x = sm + (s.col + 1) * cellW
      const y = p.H - sm - (s.row + 1) * cellH + 1.2 * MM
      page.drawRectangle({
        x: x - tw / 2 - 2,
        y: y - 1.5,
        width: tw + 4,
        height: size + 2.5,
        color: rgb(1, 1, 1),
        borderColor: color,
        borderWidth: 0.4,
      })
      page.drawText(label, { x: x - tw / 2, y: y, size, font: bold, color })
    }
  }

  if (o.sheetLabels && sm >= 3.5 * MM) {
    const n = p.sheets.length
    const edge = o.edge === 'long' ? 'long' : 'short'
    const text = isFront
      ? `Sheet ${sheetIdx + 1}/${n}  -  FRONT  -  print double-sided, flip on ${edge} edge, actual size (100%)`
      : `Sheet ${sheetIdx + 1}/${n}  -  BACK`
    const size = Math.min(6, sm * 0.55)
    page.drawText(text, { x: sm, y: H - sm / 2 - size * 0.35, size, font, color })
  }
}

/**
 * Build the imposed PDF.
 * @returns {Promise<{plan, bytes?:Uint8Array, fronts?:Uint8Array, backs?:Uint8Array}>}
 */
export async function buildBooklet(source, o, { split = false } = {}) {
  const p = plan(source.pages, o)
  const out = await PDFDocument.create()
  out.setTitle('Booklet')
  out.setCreator('Booklet maker')
  const font = await out.embedFont(StandardFonts.Helvetica)
  const bold = await out.embedFont(StandardFonts.HelveticaBold)

  const used = [...new Set(p.picked)]
  const srcPages = source.doc.getPages()
  const embedded = await out.embedPages(
    used.map((i) => srcPages[i]),
    used.map((i) => {
      const b = source.pages[i].box
      return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }
    }),
  )
  const embMap = new Map(used.map((i, k) => [i, embedded[k]]))

  const drawSide = (sheetIdx, side) => {
    const page = out.addPage([p.W, p.H])
    for (const cell of p.sheets[sheetIdx][side]) {
      if (cell.page !== null) drawSourcePage(page, cell, embMap.get(cell.page), source.pages[cell.page], o)
      drawNumber(page, cell, o, font)
    }
    drawMarks(page, p, sheetIdx, side, o, font, bold)
  }

  if (!split) {
    p.sheets.forEach((_, i) => {
      drawSide(i, 'front')
      drawSide(i, 'back')
    })
    return { plan: p, bytes: await out.save() }
  }

  // Manual duplex: everything in one doc first, then copy into two files.
  p.sheets.forEach((_, i) => {
    drawSide(i, 'front')
    drawSide(i, 'back')
  })
  const fronts = await PDFDocument.create()
  const backs = await PDFDocument.create()
  const idx = p.sheets.map((_, i) => i)
  const fp = await fronts.copyPages(out, idx.map((i) => 2 * i))
  fp.forEach((pg) => fronts.addPage(pg))
  const backIdx = idx.map((i) => 2 * i + 1)
  if (o.reverseBacks) backIdx.reverse()
  const bp = await backs.copyPages(out, backIdx)
  bp.forEach((pg) => backs.addPage(pg))
  return { plan: p, fronts: await fronts.save(), backs: await backs.save() }
}

/** A numbered demo PDF so the tool can be tried without a file. */
export async function samplePdf(n = 16) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage([420, 595])
    const tint = i % 2 ? rgb(0.933, 0.949, 1) : rgb(0.953, 0.957, 0.965)
    page.drawRectangle({ x: 20, y: 20, width: 380, height: 555, color: tint })
    page.drawRectangle({ x: 20, y: 535, width: 380, height: 40, color: rgb(0.31, 0.275, 0.898) })
    page.drawText('Sample booklet', { x: 36, y: 549, size: 16, font, color: rgb(1, 1, 1) })
    const t = String(i)
    const size = 180
    page.drawText(t, {
      x: 210 - font.widthOfTextAtSize(t, size) / 2,
      y: 240,
      size,
      font,
      color: rgb(0.31, 0.275, 0.898),
    })
    page.drawText(i === 1 ? 'Cover' : i === n ? 'Back cover' : `Page ${i} of ${n}`, {
      x: 36,
      y: 40,
      size: 14,
      font: reg,
      color: rgb(0.42, 0.45, 0.5),
    })
    page.drawText('top', { x: 360, y: 510, size: 11, font: reg, color: rgb(0.42, 0.45, 0.5) })
  }
  return doc.save()
}
