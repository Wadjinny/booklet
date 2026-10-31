<script setup>
const props = defineProps({ min: { type: Number, default: 0 }, max: { type: Number, default: 99 } })
const model = defineModel({ type: Number })
const set = (v) => (model.value = Math.max(props.min, Math.min(props.max, v)))
</script>

<template>
  <div class="stepper">
    <button type="button" :disabled="model <= min" aria-label="Decrease" @click="set(model - 1)">−</button>
    <span>{{ model }}</span>
    <button type="button" :disabled="model >= max" aria-label="Increase" @click="set(model + 1)">+</button>
  </div>
</template>
