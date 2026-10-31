<script setup>
defineProps({ label: String, hint: String })
const model = defineModel({ type: Boolean })
</script>

<template>
  <div class="row" @click="model = !model" style="cursor: pointer">
    <div>
      <div class="lbl">{{ label }}</div>
      <div v-if="hint" class="hint">{{ hint }}</div>
    </div>
    <button
      type="button"
      class="switch"
      :class="{ on: model }"
      role="switch"
      :aria-checked="model"
      :aria-label="label"
      @click.stop="model = !model"
    />
  </div>
</template>
