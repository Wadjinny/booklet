<script setup>
defineProps({ options: Array, compact: Boolean })
const model = defineModel()
</script>

<template>
  <div class="seg" :class="{ compact }" role="radiogroup">
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      type="button"
      role="radio"
      :aria-checked="model === opt.value"
      :class="{ on: model === opt.value }"
      @click="model = opt.value"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
