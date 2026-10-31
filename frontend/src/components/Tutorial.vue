<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({ plan: Object, opts: Object })
const step = ref(0)

const p = computed(() => props.plan)
const multiStrip = computed(() => p.value.stripsPerSheet > 1)
const multiBooklet = computed(() => p.value.booklets.length > 1)
const sheet0 = computed(() => p.value.sheets[0])
const label = (s) => (multiBooklet.value ? `B${s.booklet + 1}-${s.inBooklet + 1}` : `#${s.stackNo}`)
const pageLabel = (seqPos) => (p.value.seq[seqPos] === null ? '–' : String(seqPos + 1))
const tag = computed(() => ({ w: Math.min(p.value.cellW * 1.2, p.value.W * 0.17), h: Math.min(p.value.cellH * 0.25, p.value.W * 0.06) }))
const fontFor = computed(() => Math.min(p.value.cellW, p.value.cellH) * 0.34)

// SVG y is top-down, PDF y is bottom-up.
const sy = (c) => p.value.H - c.y - c.h

const firstStrips = computed(() => {
  const first = multiBooklet.value ? p.value.strips.filter((s) => s.booklet === 0) : p.value.strips
  return first.slice(0, 4)
})
const firstStrip = computed(() => p.value.strips[0])

const steps = computed(() => {
  const o = props.opts
  const n = p.value.sheets.length
  const edge = o.edge === 'long' ? 'long' : 'short'
  const list = []
  list.push({
    key: 'print',
    title: 'Print',
    text:
      o.output === 'manual'
        ? `Print the "fronts" file (${n} sheet${n > 1 ? 's' : ''}). Put the printed pile back in the tray so the blank side gets printed, then print the "backs" file. Set the scale to 100% / actual size.`
        : `Print all ${n} sheet${n > 1 ? 's' : ''} double-sided on ${o.paper}. In the print dialog pick "flip on ${edge} edge" and set the scale to 100% / actual size, not "fit to page".`,
  })
  if (multiStrip.value) {
    list.push({
      key: 'cut',
      title: 'Cut',
      text:
        o.stackMode === 'cutstack'
          ? `Keep the sheets in order (sheet 1 on top, fronts facing up) and cut the whole pile at once along the dashed lines. Trim the outer border too.`
          : `Cut each sheet along the dashed lines and trim the outer border. Each strip has a small number at the bottom of its fold line.`,
    })
  }
  list.push({
    key: 'stack',
    title: 'Stack',
    text: multiStrip.value
      ? multiBooklet.value
        ? `Make one pile per booklet. In each pile put the strips in number order (B1-1 on top, then B1-2, and so on), with the numbered side facing up.`
        : `Pile the strips by number: #1 on top, then #2, down to #${p.value.strips.length}. The side with the small number faces up.`
      : `Pile the sheets in order, sheet 1 on top, fronts facing up.`,
  })
  list.push({
    key: 'fold',
    title: 'Fold',
    text: `Fold the pile in half along the dotted line, folding the ${o.rtl ? 'right' : 'left'} half underneath. Page 1 ends up on the cover. Press the fold flat.`,
  })
  list.push({
    key: 'bind',
    title: 'Bind',
    text: multiBooklet.value
      ? `Repeat for each of the ${p.value.booklets.length} booklets. Staple each one along its fold, then put them in order (B1, B2…) and glue or sew them together at the spine.`
      : `Staple twice along the fold, or sew it. If the inner pages stick out at the edge, trim them with a ruler. That's it, your booklet is done.`,
  })
  return list
})

watch(
  () => steps.value.length,
  () => (step.value = Math.min(step.value, steps.value.length - 1)),
)
const cur = computed(() => steps.value[step.value])

const cutXs = computed(() => {
  const xs = []
  for (let c = 0; c <= p.value.cols; c += 2) xs.push(p.value.sheetMargin + c * p.value.cellW)
  return xs
})
const cutYs = computed(() => {
  const ys = []
  for (let r = 0; r <= p.value.rows; r++) ys.push(p.value.sheetMargin + r * p.value.cellH)
  return ys
})
const foldXs = computed(() => {
  const xs = []
  for (let c = 1; c < p.value.cols; c += 2) xs.push(p.value.sheetMargin + c * p.value.cellW)
  return xs
})
</script>

<template>
  <section class="card tut">
    <div class="card-head">
      <div>
        <h3>How to put it together</h3>
        <div class="muted">Shown for sheet 1. The other sheets work the same way.</div>
      </div>
      <span class="chip flat">{{ step + 1 }} / {{ steps.length }}</span>
    </div>

    <div class="tabs-row seg compact">
      <button v-for="(s, i) in steps" :key="s.key" :class="{ on: step === i }" @click="step = i">
        {{ i + 1 }}. {{ s.title }}
      </button>
    </div>

    <div class="stage">
      <!-- PRINT: front + back of sheet 1 -->
      <div v-if="cur.key === 'print'" class="pair">
        <figure v-for="side in ['front', 'back']" :key="side">
          <svg :viewBox="`0 0 ${p.W} ${p.H}`" class="sheet">
            <rect :width="p.W" :height="p.H" rx="10" class="paper" />
            <g v-for="(c, i) in sheet0[side]" :key="i">
              <rect :x="c.x + 4" :y="sy(c) + 4" :width="c.w - 8" :height="c.h - 8" rx="6" class="cell" :class="{ blank: c.page === null }" />
              <text
                :x="c.x + c.w / 2"
                :y="sy(c) + c.h / 2"
                :font-size="fontFor"
                class="num"
                :transform="c.rot ? `rotate(180 ${c.x + c.w / 2} ${sy(c) + c.h / 2})` : ''"
              >
                {{ pageLabel(c.seqPos) }}
              </text>
            </g>
          </svg>
          <figcaption>{{ side === 'front' ? 'Front' : 'Back' }}</figcaption>
        </figure>
        <div class="flip">
          <svg viewBox="0 0 60 40" width="56">
            <path
              v-if="p.axis === 'v'"
              d="M8 26 C 18 6, 42 6, 52 26"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
            />
            <path v-if="p.axis === 'v'" d="M45 22 L52 27 L54 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            <path
              v-if="p.axis === 'h'"
              d="M30 4 C 50 10, 50 30, 30 36"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
            />
            <path v-if="p.axis === 'h'" d="M36 30 L30 36 L37 40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Flip on {{ opts.edge }} edge</span>
        </div>
      </div>

      <!-- CUT -->
      <div v-else-if="cur.key === 'cut'" class="single">
        <svg :viewBox="`-16 -16 ${p.W + 32} ${p.H + 32}`" class="sheet big">
          <rect :width="p.W" :height="p.H" rx="10" class="paper" />
          <g v-for="(c, i) in sheet0.front" :key="i">
            <rect :x="c.x + 4" :y="sy(c) + 4" :width="c.w - 8" :height="c.h - 8" rx="6" class="cell" :class="{ blank: c.page === null }" />
            <text :x="c.x + c.w / 2" :y="sy(c) + c.h / 2" :font-size="fontFor * 0.8" class="num faint">{{ pageLabel(c.seqPos) }}</text>
          </g>
          <line v-for="x in foldXs" :key="'f' + x" :x1="x" :x2="x" :y1="p.sheetMargin" :y2="p.H - p.sheetMargin" class="fold" />
          <line v-for="x in cutXs" :key="'x' + x" :x1="x" :x2="x" :y1="-12" :y2="p.H + 12" class="cut" />
          <line v-for="y in cutYs" :key="'y' + y" :y1="y" :y2="y" :x1="-12" :x2="p.W + 12" class="cut" />
          <g v-for="s in sheet0.strips" :key="'s' + s.stackNo">
            <rect
              :x="p.sheetMargin + (s.col + 1) * p.cellW - tag.w / 2"
              :y="p.sheetMargin + (s.row + 1) * p.cellH - tag.h - 6"
              :width="tag.w"
              :height="tag.h"
              :rx="tag.h / 2"
              class="tag"
            />
            <text :x="p.sheetMargin + (s.col + 1) * p.cellW" :y="p.sheetMargin + (s.row + 1) * p.cellH - tag.h / 2 - 6" class="tagtxt" :font-size="tag.h * 0.6">
              {{ label(s) }}
            </text>
          </g>
          <text x="-6" y="-2" class="scissors">✂</text>
        </svg>
        <div class="legend">
          <span><i class="lg-cut" /> cut</span>
          <span><i class="lg-fold" /> fold (later)</span>
        </div>
      </div>

      <!-- STACK -->
      <div v-else-if="cur.key === 'stack'" class="single">
        <svg viewBox="0 0 300 200" class="sheet big">
          <g v-for="(s, i) in [...firstStrips].reverse()" :key="s.stackNo" :transform="`translate(${(firstStrips.length - 1 - i) * 18 + 40}, ${(firstStrips.length - 1 - i) * 22 + 20})`">
            <rect width="190" height="100" rx="8" class="cell strip" />
            <line x1="95" x2="95" y1="8" y2="92" class="fold" />
            <text x="47" y="56" font-size="30" class="num">{{ pageLabel(s.front[0]) }}</text>
            <text x="142" y="56" font-size="30" class="num">{{ pageLabel(s.front[1]) }}</text>
            <rect x="73" y="84" width="44" height="14" rx="7" class="tag" />
            <text x="95" y="91.5" class="tagtxt" font-size="9px">{{ label(s) }}</text>
          </g>
        </svg>
        <div class="legend">
          <span>{{ multiStrip ? `${label(firstStrips[0])} on top` : 'Sheet 1 on top' }}</span>
        </div>
      </div>

      <!-- FOLD -->
      <div v-else-if="cur.key === 'fold'" class="single">
        <svg viewBox="0 0 320 170" class="sheet big">
          <g transform="translate(10,30)">
            <rect width="170" height="110" rx="8" class="cell strip" />
            <line x1="85" x2="85" y1="6" y2="104" class="fold" />
            <text x="42" y="60" font-size="30" class="num faint">{{ pageLabel(firstStrip.front[0]) }}</text>
            <text x="128" y="60" font-size="30" class="num">{{ pageLabel(firstStrip.front[1]) }}</text>
            <path
              :d="opts.rtl ? 'M150 -6 C 120 -26, 100 -20, 92 -6' : 'M20 -6 C 50 -26, 70 -20, 78 -6'"
              fill="none"
              class="arrow"
            />
            <text x="85" y="128" class="cap">fold {{ opts.rtl ? 'right' : 'left' }} half under</text>
          </g>
          <path d="M196 85 h22 m-8 -8 l8 8 l-8 8" fill="none" class="arrow" />
          <g transform="translate(236,30)">
            <rect x="4" y="4" width="76" height="110" rx="6" class="cell shadow" />
            <rect width="76" height="110" rx="6" class="cell cover" />
            <text x="38" y="62" font-size="34" class="num">{{ opts.rtl ? pageLabel(firstStrip.front[0]) : pageLabel(firstStrip.front[1]) }}</text>
            <line :x1="opts.rtl ? 76 : 0" :x2="opts.rtl ? 76 : 0" y1="0" y2="110" class="spine" />
          </g>
        </svg>
      </div>

      <!-- BIND -->
      <div v-else class="single">
        <svg viewBox="0 0 320 170" class="sheet big">
          <g v-for="(b, i) in p.booklets" :key="i" :transform="`translate(${120 - (p.booklets.length - 1) * 22 + i * 44}, ${30 + i * 4})`">
            <rect width="80" height="112" rx="6" class="cell cover" />
            <line :x1="opts.rtl ? 80 : 0" :x2="opts.rtl ? 80 : 0" y1="0" y2="112" class="spine" />
            <rect :x="opts.rtl ? 76 : -4" y="26" width="8" height="3" rx="1.5" class="staple" />
            <rect :x="opts.rtl ? 76 : -4" y="83" width="8" height="3" rx="1.5" class="staple" />
            <text x="40" y="62" font-size="18" class="num">{{ p.booklets.length > 1 ? 'B' + (i + 1) : '1' }}</text>
          </g>
        </svg>
      </div>
    </div>

    <p class="body steptext">{{ cur.text }}</p>

    <div class="nav">
      <button class="btn ghost small" :disabled="step === 0" @click="step--">Back</button>
      <div class="dots">
        <i v-for="(s, i) in steps" :key="s.key" :class="{ on: i === step }" />
      </div>
      <button class="btn soft small" :disabled="step === steps.length - 1" @click="step++">Next</button>
    </div>
  </section>
</template>

<style scoped>
.tabs-row {
  overflow-x: auto;
  scrollbar-width: none;
  margin-bottom: 14px;
}
.tabs-row::-webkit-scrollbar {
  display: none;
}
.stage {
  background: var(--g100);
  border-radius: var(--r-ctrl);
  padding: 16px;
  min-height: 210px;
  display: grid;
  place-items: center;
}
.pair {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  width: 100%;
}
.pair figure {
  flex: 1;
  max-width: 170px;
  min-width: 100px;
  text-align: center;
}
.pair figure:nth-of-type(2) {
  order: 3;
}
.flip {
  order: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--indigo);
  font-size: 11px;
  font-weight: 700;
  gap: 2px;
  text-align: center;
  max-width: 70px;
}
figcaption {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--g500);
  margin-top: 6px;
}
.single {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.sheet {
  width: 100%;
  display: block;
  overflow: visible;
}
.sheet.big {
  max-width: 340px;
  max-height: 300px;
}
.paper {
  fill: #fff;
  filter: drop-shadow(0 4px 10px rgba(17, 24, 39, 0.08));
}
.cell {
  fill: var(--indigo-soft);
}
.cell.blank {
  fill: var(--g100);
}
.cell.strip {
  fill: #fff;
  stroke: var(--g200);
  stroke-width: 1.5;
}
.cell.cover {
  fill: #fff;
  stroke: var(--g300);
  stroke-width: 1.5;
}
.cell.shadow {
  fill: var(--g200);
}
.num {
  fill: var(--indigo);
  font-weight: 750;
  text-anchor: middle;
  dominant-baseline: central;
}
.num.faint {
  fill: var(--indigo-100);
}
.cut {
  stroke: var(--indigo);
  stroke-width: 3;
  stroke-dasharray: 10 7;
}
.fold {
  stroke: var(--g400);
  stroke-width: 2;
  stroke-dasharray: 2 5;
  stroke-linecap: round;
}
.tag {
  fill: #fff;
  stroke: var(--indigo);
  stroke-width: 1.5;
}
.tagtxt {
  fill: var(--indigo);
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
}
.scissors {
  font-size: 26px;
  fill: var(--indigo);
}
.arrow {
  stroke: var(--indigo);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.spine {
  stroke: var(--indigo);
  stroke-width: 3;
}
.staple {
  fill: var(--g500);
}
.cap {
  font-size: 11px;
  fill: var(--g500);
  font-weight: 600;
  text-anchor: middle;
}
.legend {
  display: flex;
  gap: 14px;
  font-size: 11.5px;
  color: var(--g500);
  font-weight: 600;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lg-cut,
.lg-fold {
  display: inline-block;
  width: 22px;
  border-top: 3px dashed var(--indigo);
}
.lg-fold {
  border-top: 2px dotted var(--g400);
}
.steptext {
  margin: 14px 2px 14px;
  line-height: 1.55;
  min-height: 3em;
}
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dots {
  display: flex;
  gap: 6px;
}
.dots i {
  width: 7px;
  height: 7px;
  border-radius: var(--r-pill);
  background: var(--g200);
  transition: 0.15s;
}
.dots i.on {
  width: 20px;
  background: var(--indigo);
}
</style>
