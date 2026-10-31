// Imposition planner for "cut & stack" booklets.
//
// Every sheet side is a grid of cells. Two horizontally adjacent cells form a
// "strip" (one spread). Each strip is printed on both sides, so it carries 4
// booklet pages. After cutting, strips are stacked (#1 on top) and folded in
// the middle, page 1 outside.
//
// All geometry is in PDF points (1/72 in), origin bottom-left.

export const MM = 72 / 25.4

export const PAPERS = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8],
}

export const DEFAULTS = {
  perSide: 4,
  paper: 'A4',
  orientation: 'auto', // auto | portrait | landscape
  edge: 'long', // duplex flip edge: long | short
  output: 'duplex', // duplex | manual
  reverseBacks: false,
  booklets: 1, // 1..5
  stackMode: 'cutstack', // cutstack | sequential
  range: '',
  blanksStart: 0,
  blankPlacement: 'end', // end | beforeLast
  rtl: false,
  fit: 'contain', // contain | cover | stretch | actual
  autoRotate: true,
  sheetMargin: 6, // mm, unprintable border around the grid
  margin: 3, // mm, inside each cell
  spineMargin: 0, // mm, extra on the fold side
  creep: 0, // mm per strip, shifts inner pages toward the fold
  numbers: false,
  numberPos: 'bottom-center', // bottom-center | bottom-outer | top-center | top-outer
  numberStart: 1,
  numberSkipFirst: true,
  numberBlanks: false,
  numberSize: 8,
  cutLines: true,
  cutStyle: 'dashed', // dashed | ticks
  foldLines: true,
  marksBothSides: false,
  sheetLabels: true,
  stackNumbers: true,
  markTone: 'gray', // light | gray | black
}

/** Parse "1-3, 7, 10-" into 0-based indices (in the given order). */
export function parseRange(text, count) {
  const t = (text || '').trim()
  if (!t) return [...Array(count).keys()]
  const out = []
  for (const part of t.split(',')) {
    const m = part.trim().match(/^(\d*)\s*(?:-\s*(\d*))?$/)
    if (!m || (!m[1] && !m[2])) continue
    const isRange = part.includes('-')
    let a = m[1] ? +m[1] : 1
    let b = isRange ? (m[2] ? +m[2] : count) : a
    a = Math.max(1, Math.min(count, a))
    b = Math.max(1, Math.min(count, b))
    const step = a <= b ? 1 : -1
    for (let i = a; i !== b + step; i += step) out.push(i - 1)
  }
  return out.length ? out : [...Array(count).keys()]
}

/** Which axis the sheet turns around when the printer flips it. */
export function flipAxis(landscape, edge) {
  // 'v' = turns like a book page (columns mirror), 'h' = like a notepad (rows mirror)
  const longIsVertical = !landscape
  return (edge === 'long') === longIsVertical ? 'v' : 'h'
}

function fitArea(pw, ph, bw, bh) {
  const s = Math.min(bw / pw, bh / ph)
  return pw * s * ph * s
}

/** Pick sheet orientation + grid that wastes the least space for the source aspect. */
export function chooseGrid(perSide, paper, orientation, srcW, srcH, autoRotate) {
  const [pw, ph] = PAPERS[paper].map((v) => v * MM)
  const best = { score: -1 }
  for (const land of [false, true]) {
    if (orientation === 'portrait' && land) continue
    if (orientation === 'landscape' && !land) continue
    const W = land ? ph : pw
    const H = land ? pw : ph
    for (let cols = 2; cols <= perSide; cols += 2) {
      if (perSide % cols) continue
      const rows = perSide / cols
      const cw = W / cols
      const ch = H / rows
      let score = fitArea(srcW, srcH, cw, ch)
      if (autoRotate) score = Math.max(score, fitArea(srcH, srcW, cw, ch) * 0.98)
      // Very long, thin strips are awkward to cut and fold.
      if (cols > 4 || rows > 4) score *= 0.9
      if (score > best.score) Object.assign(best, { score, land, W, H, cols, rows })
    }
  }
  return best
}

/**
 * @param {{w:number,h:number}[]} srcPages displayed size of each source page
 * @param {typeof DEFAULTS} o
 */
export function plan(srcPages, o) {
  const picked = parseRange(o.range, srcPages.length)
  const ref = srcPages[picked[0]] || { w: 595, h: 842 }
  const g = chooseGrid(o.perSide, o.paper, o.orientation, ref.w, ref.h, o.autoRotate)
  const { W, H, cols, rows, land } = g
  const sm = o.sheetMargin * MM
  const cellW = (W - 2 * sm) / cols
  const cellH = (H - 2 * sm) / rows
  const axis = flipAxis(land, o.edge)
  const pairsPerRow = cols / 2
  const stripsPerSheet = pairsPerRow * rows

  // ---- page sequence (null = blank)
  let seq = [...Array(o.blanksStart).fill(null), ...picked]
  const totalStrips = Math.max(1, Math.ceil(seq.length / 4))
  const nBooklets = Math.max(1, Math.min(o.booklets, totalStrips))
  const blanksNeeded = totalStrips * 4 - seq.length
  if (blanksNeeded) {
    const pad = Array(blanksNeeded).fill(null)
    if (o.blankPlacement === 'beforeLast' && seq.length > 1) {
      seq = [...seq.slice(0, -1), ...pad, seq[seq.length - 1]]
    } else seq = [...seq, ...pad]
  }

  // ---- split into booklets, each a whole number of strips
  const booklets = []
  let cursor = 0
  for (let b = 0; b < nBooklets; b++) {
    const strips = Math.floor(totalStrips / nBooklets) + (b < totalStrips % nBooklets ? 1 : 0)
    booklets.push({ index: b, strips, first: cursor, pages: strips * 4 })
    cursor += strips * 4
  }

  // ---- strips: which 4 sequence positions each carries
  const strips = []
  for (const bk of booklets) {
    const P = bk.pages
    for (let i = 0; i < bk.strips; i++) {
      let front = [P - 1 - 2 * i, 2 * i] // [left, right] as seen
      let back = [2 * i + 1, P - 2 - 2 * i] // [left, right] after flipping like a book
      if (o.rtl) {
        front = [front[1], front[0]]
        back = [back[1], back[0]]
      }
      strips.push({
        booklet: bk.index,
        inBooklet: i,
        front: front.map((p) => bk.first + p),
        back: back.map((p) => bk.first + p),
      })
    }
  }

  const sheetCount = Math.ceil(strips.length / stripsPerSheet)
  const sheets = Array.from({ length: sheetCount }, () => ({ front: [], back: [], strips: [] }))

  const cellRect = (r, c) => ({
    x: sm + c * cellW,
    y: H - sm - (r + 1) * cellH,
    w: cellW,
    h: cellH,
  })
  const mkCell = (r, c, rot, seqPos, side, strip) => ({
    ...cellRect(r, c),
    rot,
    seqPos,
    page: seq[seqPos],
    side, // 'L' | 'R' : which side of the fold the page sits on when reading
    strip,
  })

  strips.forEach((s, gi) => {
    let pos, sheet
    if (o.stackMode === 'sequential') {
      pos = gi % stripsPerSheet
      sheet = Math.floor(gi / stripsPerSheet)
    } else {
      pos = Math.floor(gi / sheetCount)
      sheet = gi % sheetCount
    }
    const r = Math.floor(pos / pairsPerRow)
    const c = (pos % pairsPerRow) * 2
    s.stackNo = gi + 1
    s.sheet = sheet
    s.pos = pos
    s.row = r
    s.col = c
    const sh = sheets[sheet]
    sh.strips.push(s)
    sh.front.push(mkCell(r, c, 0, s.front[0], 'L', s), mkCell(r, c + 1, 0, s.front[1], 'R', s))
    if (axis === 'v') {
      sh.back.push(
        mkCell(r, cols - 2 - c, 0, s.back[0], 'L', s),
        mkCell(r, cols - 1 - c, 0, s.back[1], 'R', s),
      )
    } else {
      const rr = rows - 1 - r
      sh.back.push(mkCell(rr, c + 1, 180, s.back[0], 'L', s), mkCell(rr, c, 180, s.back[1], 'R', s))
    }
  })

  return {
    W,
    H,
    landscape: land,
    cols,
    rows,
    cellW,
    cellH,
    sheetMargin: sm,
    axis,
    seq,
    picked,
    booklets,
    strips,
    sheets,
    stripsPerSheet,
    blanksAdded: seq.filter((p) => p === null).length,
    emptySlots: sheetCount * stripsPerSheet - strips.length,
    // physical size of one finished booklet page, mm
    pageMM: [cellW / MM, cellH / MM],
  }
}
