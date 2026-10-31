<script setup>
import { computed, nextTick, reactive, ref, shallowRef, watch, onMounted } from 'vue'
import { DEFAULTS, PAPERS } from './lib/plan.js'
import { buildBooklet, loadSource, samplePdf } from './lib/build.js'
import { openPdf, renderPage } from './lib/render.js'
import Seg from './components/Seg.vue'
import Toggle from './components/Toggle.vue'
import Slider from './components/Slider.vue'
import Stepper from './components/Stepper.vue'
import Tutorial from './components/Tutorial.vue'
import ZoomPane from './components/ZoomPane.vue'

const STORE = 'booklet-maker:opts'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}')
  } catch {
    return {}
  }
})()
const opts = reactive({ ...DEFAULTS, ...saved, range: '' })
watch(opts, () => localStorage.setItem(STORE, JSON.stringify({ ...opts, range: '' })), { deep: true })
function resetAll() {
  Object.assign(opts, DEFAULTS)
}

const file = ref(null) // { name, size, pages }
const source = shallowRef(null)
const result = shallowRef(null) // { plan, bytes }
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const dragging = ref(false)
const fileInput = ref(null)

async function useBytes(bytes, name) {
  error.value = ''
  loading.value = true
  try {
    source.value = await loadSource(bytes)
    file.value = { name, size: bytes.byteLength, pages: source.value.pages.length }
    opts.range = ''
    sheet.value = 0
    side.value = 'front'
  } catch (e) {
    console.error(e)
    error.value = 'This file could not be read as a PDF. It may be damaged or password-protected.'
  } finally {
    loading.value = false
  }
}
async function onFile(f) {
  if (!f) return
  if (f.type && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
    error.value = 'Please choose a PDF file.'
    return
  }
  await useBytes(new Uint8Array(await f.arrayBuffer()), f.name)
}
function onDrop(e) {
  dragging.value = false
  onFile(e.dataTransfer.files?.[0])
}
async function trySample() {
  await useBytes(await samplePdf(16), 'sample-16-pages.pdf')
}

// ---------- build (debounced) ----------
let timer = null
let ticket = 0
async function rebuild() {
  if (!source.value) return
  const my = ++ticket
  busy.value = true
  try {
    const r = await buildBooklet(source.value, { ...opts })
    if (my !== ticket) return
    result.value = r
    error.value = ''
    if (sheet.value >= r.plan.sheets.length) sheet.value = 0
    const doc = await openPdf(r.bytes)
    if (my !== ticket) return doc.destroy()
    const old = previewDoc
    previewDoc = doc
    setTimeout(() => old?.destroy(), 2000)
    await nextTick()
    drawPreview()
  } catch (e) {
    console.error(e)
    if (my === ticket) error.value = 'Something went wrong while building the booklet: ' + e.message
  } finally {
    if (my === ticket) busy.value = false
  }
}
watch([source, () => ({ ...opts })], () => {
  clearTimeout(timer)
  timer = setTimeout(rebuild, 250)
})

// ---------- preview ----------
const sheet = ref(0)
const side = ref('front')
const canvas = ref(null)
const frame = ref(null)
// Render resolution follows the zoom (in steps), so zoomed-in text stays sharp.
const renderZoom = ref(1)
function onZoomSettle(z) {
  const q = z <= 1 ? 1 : Math.min(4, Math.ceil(z * 2) / 2)
  if (q !== renderZoom.value) {
    renderZoom.value = q
    drawPreview()
  }
}
let previewDoc = null
let drawing = false
let redraw = false
// pdf.js can't render twice into one canvas at the same time, so serialize.
async function drawPreview() {
  if (drawing) {
    redraw = true
    return
  }
  drawing = true
  try {
    do {
      redraw = false
      if (!previewDoc || !canvas.value || !result.value) break
      const idx = sheet.value * 2 + (side.value === 'back' ? 1 : 0)
      const w = Math.min((frame.value?.$el?.clientWidth || 360) - 28, 900)
      try {
        await renderPage(previewDoc, idx, canvas.value, w, renderZoom.value)
      } catch (e) {
        console.error(e)
      }
    } while (redraw)
  } finally {
    drawing = false
  }
}
watch([sheet, side], () => {
  frame.value?.reset(false)
  renderZoom.value = 1
  drawPreview()
})
let resizeTimer = null
onMounted(() => {
  let last = window.innerWidth
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - last) < 40) return
    last = window.innerWidth
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(drawPreview, 200)
  })
})

const plan = computed(() => result.value?.plan)
const sheetCount = computed(() => plan.value?.sheets.length || 0)
const prevSheet = () => (sheet.value = (sheet.value - 1 + sheetCount.value) % sheetCount.value)
const nextSheet = () => (sheet.value = (sheet.value + 1) % sheetCount.value)

function onSwipe(dir) {
  if (dir > 0) {
    if (side.value === 'front') side.value = 'back'
    else if (sheetCount.value > 1) {
      nextSheet()
      side.value = 'front'
    }
  } else if (side.value === 'back') side.value = 'front'
  else if (sheetCount.value > 1) {
    prevSheet()
    side.value = 'back'
  }
}

// ---------- downloads ----------
const baseName = computed(() => (file.value?.name || 'booklet').replace(/\.pdf$/i, '') + `-booklet-${opts.perSide}up`)
function save(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
const downloading = ref(false)
async function download(part) {
  if (!source.value) return
  downloading.value = true
  try {
    if (opts.output === 'manual') {
      const r = await buildBooklet(source.value, { ...opts }, { split: true })
      if (part === 'backs') save(r.backs, `${baseName.value}-2-backs.pdf`)
      else save(r.fronts, `${baseName.value}-1-fronts.pdf`)
    } else {
      save(result.value.bytes, `${baseName.value}.pdf`)
    }
  } finally {
    downloading.value = false
  }
}
function openToPrint() {
  if (!result.value) return
  const url = URL.createObjectURL(new Blob([result.value.bytes], { type: 'application/pdf' }))
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

// ---------- display helpers ----------
const perSideOptions = [2, 4, 8, 16]
const gridIcon = (n) => ({ 2: [2, 1], 4: [2, 2], 8: [4, 2], 16: [4, 4] })[n]
const fmtSize = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' kB')
const pageSize = computed(() => {
  if (!plan.value) return ''
  const [w, h] = plan.value.pageMM
  return `${Math.round(w)} × ${Math.round(h)} mm`
})
const edgeHint = computed(() => {
  if (!plan.value) return 'Match this to the setting in your print dialog.'
  const typical = plan.value.landscape ? 'short' : 'long'
  return opts.edge === typical
    ? 'Match this to the setting in your print dialog.'
    : `Works too. The backs will look upside-down on screen; that's expected. Most printers use "${typical} edge" for this layout.`
})
const summary = computed(() => {
  if (!plan.value) return {}
  const p = plan.value
  return {
    printing: `${opts.paper} ${p.landscape ? 'landscape' : 'portrait'} · ${opts.edge} edge${opts.output === 'manual' ? ' · manual' : ''}`,
    pages: `${p.picked.length} pages${p.blanksAdded ? ` + ${p.blanksAdded} blank` : ''}${opts.rtl ? ' · right-to-left' : ''}`,
    booklets: `${p.booklets.length} booklet${p.booklets.length > 1 ? 's' : ''} · ${opts.stackMode === 'cutstack' ? 'cut & stack' : 'sheet by sheet'}`,
    fit: `${{ contain: 'Fit', cover: 'Fill', stretch: 'Stretch', actual: 'Actual size' }[opts.fit]} · ${opts.margin} mm margin`,
    numbers: opts.numbers ? `On · ${opts.numberPos.replace('-', ' ')}` : 'Off',
    marks: [opts.cutLines && 'cut', opts.foldLines && 'fold', opts.stackNumbers && 'strip #', opts.sheetLabels && 'labels'].filter(Boolean).join(' · ') || 'None',
  }
})
const maxBooklets = computed(() => Math.min(5, Math.max(1, Math.ceil(((file.value?.pages || 4) + opts.blanksStart) / 4))))
watch(maxBooklets, (m) => {
  if (opts.booklets > m) opts.booklets = m
})
</script>

<template>
  <div class="app">
    <header class="top">
      <div class="logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round">
          <path d="M12 6v14M4 6.5c3-1.3 5.7-1.3 8 0 2.3-1.3 5-1.3 8 0v13c-3-1.3-5.7-1.3-8 0-2.3-1.3-5-1.3-8 0z" />
        </svg>
      </div>
      <div>
        <h1>Booklet maker</h1>
        <p>PDF to a print, cut and fold booklet</p>
      </div>
      <span class="chip flat lock" title="Your PDF never leaves this device">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><rect x="5" y="11" width="14" height="10" rx="3" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        Offline
      </span>
    </header>

    <main class="layout">
      <div class="main-col">
        <!-- UPLOAD -->
        <section
          class="card o-upload drop"
          :class="{ dragging, has: file }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <input ref="fileInput" type="file" accept="application/pdf,.pdf" hidden @change="onFile($event.target.files[0]); $event.target.value = ''" />
          <template v-if="!file">
            <button class="drop-btn" @click="fileInput.click()">
              <div class="bubble big">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 0-4.5 4.5M12 3l4.5 4.5M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" /></svg>
              </div>
              <div class="drop-t">{{ loading ? 'Reading PDF…' : 'Choose a PDF' }}</div>
              <div class="muted">or drop it here. Nothing gets uploaded.</div>
            </button>
            <button class="btn soft small sample" @click="trySample">Try with a 16-page sample</button>
          </template>
          <div v-else class="file-row">
            <div class="bubble">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
            </div>
            <div class="file-meta">
              <div class="fname">{{ file.name }}</div>
              <div class="muted">{{ file.pages }} pages · {{ fmtSize(file.size) }}</div>
            </div>
            <button class="btn ghost small" @click="fileInput.click()">Change</button>
          </div>
          <p v-if="error" class="err">{{ error }}</p>
        </section>

        <!-- FORMAT -->
        <section class="card o-format">
          <div class="card-head">
            <div>
              <h3>Pages per side</h3>
              <div class="muted">How many booklet pages fit on each side of the paper</div>
            </div>
          </div>
          <div class="ps-grid">
            <button v-for="n in perSideOptions" :key="n" class="ps" :class="{ on: opts.perSide === n }" @click="opts.perSide = n">
              <span class="ps-icon" :style="{ gridTemplateColumns: `repeat(${gridIcon(n)[0]},1fr)` }">
                <i v-for="k in n" :key="k" />
              </span>
              <span class="ps-n">{{ n }}</span>
            </button>
          </div>
          <div v-if="plan" class="chips stats">
            <span class="chip">Page ≈ {{ pageSize }}</span>
            <span class="chip">{{ sheetCount }} sheet{{ sheetCount > 1 ? 's' : '' }}</span>
            <span class="chip flat">{{ plan.strips.length }} strip{{ plan.strips.length > 1 ? 's' : '' }}</span>
            <span v-if="plan.blanksAdded" class="chip flat">{{ plan.blanksAdded }} blank page{{ plan.blanksAdded > 1 ? 's' : '' }} added</span>
            <span v-if="plan.emptySlots" class="chip flat">{{ plan.emptySlots }} empty slot{{ plan.emptySlots > 1 ? 's' : '' }}</span>
          </div>
        </section>

        <!-- SETTINGS -->
        <div class="o-settings settings">
          <details class="card" open>
            <summary>
              <div class="bubble"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><path d="M7 14h10v7H7z" /></svg></div>
              <div class="txt"><div class="t">Paper & printing</div><div class="s">{{ summary.printing || 'A4 · double-sided' }}</div></div>
              <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <div class="inner">
              <div class="row">
                <div class="lbl">Paper size</div>
                <select v-model="opts.paper" aria-label="Paper size">
                  <option v-for="(v, k) in PAPERS" :key="k" :value="k">{{ k }}</option>
                </select>
              </div>
              <div class="row stack">
                <div class="lbl">Sheet orientation</div>
                <Seg v-model="opts.orientation" :options="[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]" />
                <div class="hint">Auto picks whichever wastes the least paper for your pages.</div>
              </div>
              <div class="row stack">
                <div class="lbl">Double-sided: flip on</div>
                <Seg v-model="opts.edge" :options="[{ value: 'long', label: 'Long edge' }, { value: 'short', label: 'Short edge' }]" />
                <div class="hint">{{ edgeHint }}</div>
              </div>
              <div class="row stack">
                <div class="lbl">Printer</div>
                <Seg v-model="opts.output" :options="[{ value: 'duplex', label: 'Prints both sides' }, { value: 'manual', label: 'One side only' }]" />
                <div class="hint">
                  {{ opts.output === 'duplex' ? 'One PDF, fronts and backs alternating.' : 'Two PDFs: print the fronts, put the pile back in the tray, then print the backs.' }}
                </div>
              </div>
              <Toggle v-if="opts.output === 'manual'" v-model="opts.reverseBacks" label="Reverse order of backs" hint="Turn on if your printer outputs pages face up." />
            </div>
          </details>

          <details class="card">
            <summary>
              <div class="bubble"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h5" /></svg></div>
              <div class="txt"><div class="t">Pages</div><div class="s">{{ summary.pages || 'Range, blanks, reading direction' }}</div></div>
              <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <div class="inner">
              <div class="row stack">
                <div class="lbl">Page range</div>
                <input v-model.lazy="opts.range" type="text" inputmode="numeric" :placeholder="file ? `All pages (1-${file.pages}). e.g. 1-8, 12` : 'All pages. e.g. 1-8, 12'" />
              </div>
              <div class="row">
                <div>
                  <div class="lbl">Blank pages at the start</div>
                  <div class="hint">e.g. an empty inside cover</div>
                </div>
                <Stepper v-model="opts.blanksStart" :min="0" :max="8" />
              </div>
              <div class="row stack">
                <div class="lbl">Fill-up blanks go</div>
                <Seg v-model="opts.blankPlacement" :options="[{ value: 'end', label: 'At the end' }, { value: 'beforeLast', label: 'Before back cover' }]" />
                <div class="hint">Booklets need a multiple of 4 pages, so blanks are added when needed.</div>
              </div>
              <div class="row stack">
                <div class="lbl">Reading direction</div>
                <Seg v-model="opts.rtl" :options="[{ value: false, label: 'Left to right' }, { value: true, label: 'Right to left' }]" />
                <div class="hint">Right to left is for Arabic, Hebrew, manga…</div>
              </div>
            </div>
          </details>

          <details class="card">
            <summary>
              <div class="bubble"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 5h7v14H4zM13 5h7v14h-7z" /></svg></div>
              <div class="txt"><div class="t">Booklets & stacking</div><div class="s">{{ summary.booklets || 'Split into several booklets' }}</div></div>
              <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <div class="inner">
              <div class="row stack">
                <div class="lbl">Split into booklets</div>
                <Seg v-model="opts.booklets" :options="[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))" />
                <div class="hint">
                  Thick booklets are hard to fold. Split them into a few thinner ones, fold each, then put them together.
                  <template v-if="maxBooklets < 5"> With this many pages you can split into at most {{ maxBooklets }}.</template>
                </div>
              </div>
              <div class="row stack">
                <div class="lbl">Strip order</div>
                <Seg v-model="opts.stackMode" :options="[{ value: 'cutstack', label: 'Cut & stack' }, { value: 'sequential', label: 'Sheet by sheet' }]" />
                <div class="hint">
                  {{
                    opts.stackMode === 'cutstack'
                      ? 'Cut the whole pile at once. The cut piles stack straight into order.'
                      : 'Strips follow each other on the same sheet. Cut sheet by sheet.'
                  }}
                </div>
              </div>
            </div>
          </details>

          <details class="card">
            <summary>
              <div class="bubble"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" /><rect x="8" y="8" width="8" height="8" rx="1.5" /></svg></div>
              <div class="txt"><div class="t">Page fitting</div><div class="s">{{ summary.fit || 'Fit, margins, creep' }}</div></div>
              <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <div class="inner">
              <div class="row stack">
                <div class="lbl">Scaling</div>
                <Seg
                  v-model="opts.fit"
                  :options="[{ value: 'contain', label: 'Fit' }, { value: 'cover', label: 'Fill' }, { value: 'stretch', label: 'Stretch' }, { value: 'actual', label: '100%' }]"
                />
                <div class="hint">
                  {{
                    {
                      contain: 'Whole page visible, may leave white bands.',
                      cover: 'Fills the space; edges may be cropped.',
                      stretch: 'Fills the space exactly; may distort.',
                      actual: 'Original size, centered and cropped.',
                    }[opts.fit]
                  }}
                </div>
              </div>
              <Toggle v-model="opts.autoRotate" label="Auto-rotate pages" hint="Turn landscape pages to fit portrait slots, and the other way round" />
              <Slider v-model="opts.margin" label="Margin around each page" :min="0" :max="15" :step="0.5" unit="mm" />
              <Slider v-model="opts.spineMargin" label="Extra margin at the fold" :min="0" :max="15" :step="0.5" unit="mm" hint="Keeps text away from staples" />
              <Slider v-model="opts.sheetMargin" label="Paper border" :min="0" :max="15" :step="0.5" unit="mm" hint="Most printers can't print the last 4–5 mm of the sheet" />
              <Slider
                v-model="opts.creep"
                label="Creep compensation"
                :min="0"
                :max="0.5"
                :step="0.05"
                unit="mm / strip"
                hint="Thick booklets: shifts inner pages toward the fold so margins stay even after trimming. ~0.1 mm for normal paper."
              />
            </div>
          </details>

          <details class="card">
            <summary>
              <div class="bubble"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16" /></svg></div>
              <div class="txt"><div class="t">Page numbers</div><div class="s">{{ summary.numbers || 'Off' }}</div></div>
              <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <div class="inner">
              <Toggle v-model="opts.numbers" label="Add page numbers" hint="Printed in the margin of each booklet page" />
              <template v-if="opts.numbers">
                <div class="row">
                  <div class="lbl">Position</div>
                  <select v-model="opts.numberPos" aria-label="Number position">
                    <option value="bottom-center">Bottom center</option>
                    <option value="bottom-outer">Bottom outer corner</option>
                    <option value="top-center">Top center</option>
                    <option value="top-outer">Top outer corner</option>
                  </select>
                </div>
                <div class="row">
                  <div class="lbl">First number</div>
                  <Stepper v-model="opts.numberStart" :min="0" :max="999" />
                </div>
                <Slider v-model="opts.numberSize" label="Size" :min="5" :max="14" :step="0.5" unit="pt" />
                <Toggle v-model="opts.numberSkipFirst" label="Hide on the cover" />
                <Toggle v-model="opts.numberBlanks" label="Number blank pages" />
              </template>
            </div>
          </details>

          <details class="card">
            <summary>
              <div class="bubble"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></svg></div>
              <div class="txt"><div class="t">Cut & fold marks</div><div class="s">{{ summary.marks || 'Cut, fold, labels' }}</div></div>
              <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </summary>
            <div class="inner">
              <Toggle v-model="opts.cutLines" label="Cut lines" />
              <div v-if="opts.cutLines" class="row">
                <div class="lbl">Style</div>
                <Seg v-model="opts.cutStyle" compact :options="[{ value: 'dashed', label: 'Dashed lines' }, { value: 'ticks', label: 'Edge ticks' }]" />
              </div>
              <Toggle v-model="opts.foldLines" label="Fold lines" hint="Dotted line in the middle of each strip" />
              <Toggle v-model="opts.stackNumbers" label="Strip numbers" hint="Tiny #1, #2… at the fold so you know the stacking order" />
              <Toggle v-model="opts.sheetLabels" label="Sheet labels" hint="“Sheet 1/3 · FRONT” plus print settings, in the top border" />
              <Toggle v-model="opts.marksBothSides" label="Lines on both sides" hint="Off: lines only on the front, so a slight duplex offset won't show" />
              <div class="row">
                <div class="lbl">Mark color</div>
                <Seg v-model="opts.markTone" compact :options="[{ value: 'light', label: 'Light' }, { value: 'gray', label: 'Gray' }, { value: 'black', label: 'Black' }]" />
              </div>
            </div>
          </details>

          <button class="reset" @click="resetAll">Reset all settings</button>
        </div>
      </div>

      <div class="side">
        <!-- ACTION BAR -->
        <div class="bar" :class="{ hidden: !file }">
          <div class="bar-info">
            <div class="bar-t">{{ plan ? `${sheetCount} sheet${sheetCount > 1 ? 's' : ''} · ${opts.perSide} per side` : 'No PDF yet' }}</div>
            <div class="muted">{{ plan ? `${plan.booklets.length > 1 ? plan.booklets.length + ' booklets · ' : ''}${pageSize} pages` : '' }}</div>
          </div>
          <template v-if="opts.output === 'manual'">
            <button class="btn ghost" :disabled="!plan || downloading" @click="download('backs')">2. Backs</button>
            <button class="btn primary" :disabled="!plan || downloading" @click="download('fronts')">1. Fronts</button>
          </template>
          <template v-else>
            <button class="icon-btn" :disabled="!plan" title="Open to print" aria-label="Open to print" @click="openToPrint">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><path d="M7 14h10v7H7z" /></svg>
            </button>
            <button class="btn primary" :disabled="!plan || downloading" @click="download()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1" /></svg>
              Download
            </button>
          </template>
        </div>

        <!-- PREVIEW -->
        <section class="card o-preview">
          <div class="card-head">
            <div>
              <h3>Preview</h3>
              <div class="muted">{{ plan ? `Sheet ${sheet + 1} of ${sheetCount} · ${side}` : 'Load a PDF to see your sheets' }}</div>
            </div>
            <Seg v-if="plan" v-model="side" compact :options="[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]" />
          </div>
          <ZoomPane ref="frame" class="frame" :class="{ busy }" :disabled="!plan" @swipe="onSwipe" @settle="onZoomSettle">
            <canvas v-show="plan" ref="canvas" class="sheet-canvas" />
            <div v-if="!plan" class="placeholder">
              <span class="ps-icon lg" :style="{ gridTemplateColumns: `repeat(${gridIcon(opts.perSide)[0]},1fr)` }"><i v-for="k in opts.perSide" :key="k" /></span>
            </div>
          </ZoomPane>
          <div v-if="busy" class="spinner" />
          <div v-if="plan && sheetCount > 1" class="pager">
            <button class="icon-btn" aria-label="Previous sheet" @click="prevSheet">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m15 6-6 6 6 6" /></svg>
            </button>
            <div class="pdots">
              <button v-for="i in sheetCount" :key="i" :class="{ on: i - 1 === sheet }" :aria-label="`Sheet ${i}`" @click="sheet = i - 1" />
            </div>
            <button class="icon-btn" aria-label="Next sheet" @click="nextSheet">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>
          <p v-if="plan && side === 'back' && plan.axis === 'h'" class="note">
            The back looks upside down here on purpose. It comes out the right way up once the printer flips the sheet on the {{ opts.edge }} edge.
          </p>
        </section>

        <div class="o-tutorial">
          <Tutorial v-if="plan" :plan="plan" :opts="opts" />
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.lock {
  gap: 5px;
}

/* upload */
.drop {
  transition: 0.15s;
  outline: 2px dashed transparent;
  outline-offset: -8px;
}
.drop.dragging {
  outline-color: var(--indigo);
  background: var(--indigo-soft);
}
.drop-btn {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 0 12px;
  border-radius: var(--r-ctrl);
}
.bubble.big {
  width: 52px;
  height: 52px;
  margin-bottom: 6px;
}
.drop-t {
  font-size: 16px;
  font-weight: 700;
}
.sample {
  display: flex;
  margin: 8px auto 0;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.file-meta {
  flex: 1;
  min-width: 0;
}
.fname {
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.err {
  margin-top: 12px;
  background: var(--g100);
  color: var(--g700);
  font-size: 12.5px;
  font-weight: 500;
  padding: 10px 14px;
  border-radius: var(--r-ctrl);
}

/* pages per side */
.ps-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.ps {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 4px 10px;
  border-radius: var(--r-ctrl);
  background: var(--g100);
  transition: 0.15s;
}
.ps.on {
  background: var(--indigo-soft);
  box-shadow: inset 0 0 0 2px var(--indigo);
}
.ps-n {
  font-size: 20px;
  font-weight: 750;
  letter-spacing: -0.6px;
  color: var(--g500);
}
.ps.on .ps-n {
  color: var(--indigo);
}
.ps-icon {
  display: grid;
  gap: 2px;
  width: 36px;
  height: 28px;
  padding: 3px;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(17, 24, 39, 0.1);
}
.ps-icon i {
  background: var(--g300);
  border-radius: 2px;
}
.ps.on .ps-icon i {
  background: var(--indigo);
}
.ps-icon.lg {
  width: 160px;
  height: 120px;
  gap: 6px;
  padding: 10px;
}
.ps-icon.lg i {
  background: var(--indigo-soft);
  border-radius: 6px;
}
.stats {
  margin-top: 14px;
}

/* settings */
.settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.reset {
  align-self: center;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--g400);
  padding: 8px 14px;
  border-radius: var(--r-pill);
}
.reset:hover {
  color: var(--g700);
}

/* preview */
.o-preview {
  position: relative;
}
.sheet-canvas {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 70vh;
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(17, 24, 39, 0.1);
  transition: opacity 0.15s;
}
.busy .sheet-canvas {
  opacity: 0.6;
}
.placeholder {
  padding: 30px 0;
}
.spinner {
  position: absolute;
  top: 96px;
  right: 34px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 3px solid var(--indigo-100);
  border-top-color: var(--indigo);
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  gap: 10px;
}
.pdots {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
}
.pdots button {
  width: 8px;
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--g200);
  transition: 0.15s;
  padding: 0;
}
.pdots button.on {
  width: 22px;
  background: var(--indigo);
}
.note {
  margin-top: 12px;
  font-size: 12px;
  color: var(--g500);
  background: var(--indigo-soft);
  padding: 10px 14px;
  border-radius: var(--r-ctrl);
}

/* sticky action bar: fixed on mobile, inline on desktop */
.bar {
  position: fixed;
  left: 10px;
  right: 10px;
  bottom: calc(10px + env(safe-area-inset-bottom));
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: var(--r-card);
  padding: 10px 10px 10px 16px;
  box-shadow: 0 8px 30px rgba(17, 24, 39, 0.14);
  transition: transform 0.25s, opacity 0.25s;
}
.bar.hidden {
  transform: translateY(140%);
  opacity: 0;
  pointer-events: none;
}
.bar-info {
  flex: 1;
  min-width: 0;
}
.bar-info .muted {
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bar-t {
  font-weight: 700;
  font-size: 13.5px;
  white-space: nowrap;
}
.bar .icon-btn {
  box-shadow: none;
  background: var(--g100);
}
@media (min-width: 1000px) {
  .bar {
    position: static;
    box-shadow: var(--sh-card);
    background: var(--white);
    padding: 14px 14px 14px 22px;
  }
  .bar.hidden {
    transform: none;
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
