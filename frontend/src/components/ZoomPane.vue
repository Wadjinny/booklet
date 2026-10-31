<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

// Pan/zoom viewport: pinch + double-tap on touch, Ctrl/⌘+wheel, double-click and drag with a mouse.
// At 100% a horizontal swipe emits `swipe` (+1 / -1) instead of panning.
const props = defineProps({ disabled: Boolean })
const emit = defineEmits(['swipe', 'settle'])

const MIN = 1
const MAX = 6
const vp = ref(null)
const s = ref(1)
const tx = ref(0)
const ty = ref(0)
const dragging = ref(false)
const animate = ref(false)

const pct = computed(() => `${Math.round(s.value * 100)}%`)
const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

function size() {
  return { w: vp.value?.clientWidth || 1, h: vp.value?.clientHeight || 1 }
}
function clamp() {
  const { w, h } = size()
  tx.value = Math.min(0, Math.max(w - s.value * w, tx.value))
  ty.value = Math.min(0, Math.max(h - s.value * h, ty.value))
}
function local(e) {
  const r = vp.value.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

let settleTimer = null
function settle() {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => emit('settle', s.value), 180)
}

/** Zoom to `next`, keeping the point c (viewport coords) fixed on screen. */
function zoomAt(c, next, smooth = false) {
  next = Math.min(MAX, Math.max(MIN, next))
  const k = next / s.value
  tx.value = c.x - (c.x - tx.value) * k
  ty.value = c.y - (c.y - ty.value) * k
  s.value = next
  animate.value = smooth
  clamp()
  settle()
}
const center = () => ({ x: size().w / 2, y: size().h / 2 })
const zoomIn = () => zoomAt(center(), s.value * 1.5, true)
const zoomOut = () => zoomAt(center(), s.value / 1.5, true)
function reset(smooth = true) {
  animate.value = smooth
  s.value = 1
  tx.value = ty.value = 0
  settle()
}
defineExpose({ reset })

// ---------- pointers ----------
const pts = new Map()
let pan = null // { x, y, tx, ty }
let pinch = null // { d, s, mx, my, tx, ty }
let swipe = null // { x, y, t }
let lastTap = null // { x, y, t }
let lastPointerType = 'mouse'

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function startPan(p) {
  pan = { x: p.x, y: p.y, tx: tx.value, ty: ty.value }
}
function onDown(e) {
  if (props.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
  lastPointerType = e.pointerType
  const p = local(e)
  pts.set(e.pointerId, p)
  vp.value.setPointerCapture?.(e.pointerId)
  animate.value = false
  if (pts.size === 1) {
    startPan(p)
    swipe = { x: p.x, y: p.y, t: performance.now() }
    if (s.value > 1) dragging.value = true
  } else if (pts.size === 2) {
    const [a, b] = [...pts.values()]
    const m = mid(a, b)
    pinch = { d: dist(a, b) || 1, s: s.value, mx: m.x, my: m.y, tx: tx.value, ty: ty.value }
    pan = swipe = null
  }
}
function onMove(e) {
  if (!pts.has(e.pointerId)) return
  const p = local(e)
  pts.set(e.pointerId, p)
  if (pinch && pts.size >= 2) {
    const [a, b] = [...pts.values()]
    const m = mid(a, b)
    const next = Math.min(MAX, Math.max(MIN, (pinch.s * dist(a, b)) / pinch.d))
    const k = next / pinch.s
    s.value = next
    tx.value = m.x - (pinch.mx - pinch.tx) * k
    ty.value = m.y - (pinch.my - pinch.ty) * k
    clamp()
  } else if (pan && s.value > 1) {
    tx.value = pan.tx + (p.x - pan.x)
    ty.value = pan.ty + (p.y - pan.y)
    clamp()
  }
}
function onUp(e, cancelled = false) {
  if (!pts.has(e.pointerId)) return
  const p = local(e)
  pts.delete(e.pointerId)
  dragging.value = false
  if (pinch) {
    pinch = null
    // keep panning smoothly with the finger that stays down
    const rest = [...pts.values()][0]
    if (rest) startPan(rest)
    settle()
    return
  }
  if (cancelled || !swipe) return
  const dx = p.x - swipe.x
  const dy = p.y - swipe.y
  const dt = performance.now() - swipe.t
  swipe = null
  pan = null

  if (e.pointerType !== 'mouse' && Math.hypot(dx, dy) < 10 && dt < 300) {
    // double-tap
    const now = performance.now()
    if (lastTap && now - lastTap.t < 320 && dist(lastTap, p) < 30) {
      lastTap = null
      if (s.value > 1) reset()
      else zoomAt(p, 2.5, true)
    } else lastTap = { ...p, t: now }
    return
  }
  if (s.value === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) emit('swipe', dx < 0 ? 1 : -1)
  settle()
}
function onDblClick(e) {
  // touch double-taps are handled in onUp; browsers may also fire dblclick for them
  if (props.disabled || lastPointerType !== 'mouse') return
  if (s.value > 1) reset()
  else zoomAt(local(e), 2.5, true)
}
function onWheel(e) {
  if (props.disabled) return
  if (e.ctrlKey || e.metaKey) {
    // also what trackpad pinch sends
    e.preventDefault()
    const d = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY))
    const f = Math.exp(-d * 0.006)
    zoomAt(local(e), s.value * f)
  } else if (s.value > 1) {
    e.preventDefault()
    animate.value = false
    tx.value -= e.deltaX
    ty.value -= e.deltaY
    clamp()
  }
}
// Stop the browser scrolling or zooming the page during a two-finger gesture.
function onTouchStart(e) {
  if (e.touches.length > 1) e.preventDefault()
}
onMounted(() => vp.value.addEventListener('touchstart', onTouchStart, { passive: false }))
onBeforeUnmount(() => {
  vp.value?.removeEventListener('touchstart', onTouchStart)
  clearTimeout(settleTimer)
})
</script>

<template>
  <div
    ref="vp"
    class="zp"
    :class="{ zoomed: s > 1, dragging }"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp($event, true)"
    @dblclick="onDblClick"
    @wheel="onWheel"
  >
    <div class="zp-content" :class="{ animate }" :style="{ transform: `translate(${tx}px, ${ty}px) scale(${s})` }">
      <slot />
    </div>

    <div v-if="!disabled" class="zp-tools" @pointerdown.stop @dblclick.stop>
      <button type="button" aria-label="Zoom out" :disabled="s <= MIN" @click="zoomOut">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14" /></svg>
      </button>
      <button type="button" class="pct" :aria-label="s > 1 ? 'Reset zoom' : 'Zoom level'" @click="reset()">{{ pct }}</button>
      <button type="button" aria-label="Zoom in" :disabled="s >= MAX" @click="zoomIn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
    <div v-if="!disabled && s === 1" class="zp-hint">
      {{ isCoarse ? 'Pinch or double-tap to zoom' : 'Ctrl + scroll or double-click to zoom' }}
    </div>
  </div>
</template>

<style scoped>
.zp {
  position: relative;
  overflow: hidden;
  border-radius: var(--r-ctrl);
  background: var(--g100);
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.zp.zoomed {
  touch-action: none;
  cursor: grab;
}
.zp.dragging {
  cursor: grabbing;
}
.zp-content {
  transform-origin: 0 0;
  will-change: transform;
  padding: 14px 14px 48px;
  display: grid;
  place-items: center;
  min-height: 200px;
}
.zp-content.animate {
  transition: transform 0.22s ease;
}
.zp-tools {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: var(--r-pill);
  box-shadow: var(--sh-card);
}
.zp-tools button {
  height: 32px;
  min-width: 32px;
  border-radius: var(--r-pill);
  display: grid;
  place-items: center;
  color: var(--g700);
  transition: 0.15s;
}
.zp-tools button:hover:not(:disabled) {
  background: var(--g100);
}
.zp-tools .pct {
  font-size: 12px;
  font-weight: 700;
  min-width: 52px;
  font-variant-numeric: tabular-nums;
}
.zp.zoomed .zp-tools .pct {
  color: var(--indigo);
}
.zp-hint {
  position: absolute;
  left: 14px;
  bottom: 18px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--g400);
  pointer-events: none;
}
</style>
