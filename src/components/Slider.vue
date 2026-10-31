<script setup>
import { computed } from 'vue'
const props = defineProps({ label: String, hint: String, min: Number, max: Number, step: Number, unit: String })
const model = defineModel({ type: Number })
const pct = computed(() => `${((model.value - props.min) / (props.max - props.min)) * 100}%`)
const shown = computed(() => (props.step < 1 ? model.value.toFixed(2).replace(/0$/, '') : model.value))
</script>

<template>
  <div class="row stack">
    <div class="row-top">
      <span class="lbl">{{ label }}</span>
      <span class="val">{{ shown }} {{ unit }}</span>
    </div>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="model"
      :style="{ '--p': pct }"
      :aria-label="label"
      @input="model = +$event.target.value"
    />
    <div v-if="hint" class="hint">{{ hint }}</div>
  </div>
</template>
