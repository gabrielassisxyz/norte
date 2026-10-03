<script setup lang="ts">
import { computed, ref, useSlots } from 'vue'

import Icon from './Icon.vue'
import Tabs from './Tabs.vue'
import type { SidePanelProps } from './types'

const props = defineProps<SidePanelProps>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'change', value: string): void
  (event: 'update:collapsed', value: boolean): void
}>()
const slots = useSlots()

const activeTab = ref(props.defaultValue ?? props.tabs[0]?.value ?? '')
const internalCollapsed = ref(props.defaultCollapsed ?? false)
const selectedTab = computed(() => props.modelValue ?? props.value ?? activeTab.value)
const isCollapsed = computed(() => props.collapsed ?? internalCollapsed.value)
const panelSlotName = computed(() => `panel-${selectedTab.value}`)
const panelContent = computed(() => props.panels?.[selectedTab.value])

function selectTab(value: string): void {
  activeTab.value = value
  emit('update:modelValue', value)
  emit('change', value)
}

function setCollapsed(value: boolean): void {
  internalCollapsed.value = value
  emit('update:collapsed', value)
}
</script>

<template>
  <aside v-if="isCollapsed" class="nt-rail" :aria-label="`${label || 'Painel'} recolhido`">
    <button type="button" class="nt-rail-btn" aria-label="Abrir painel" @click="setCollapsed(false)">
      <Icon name="expand" />
    </button>
    <span class="nt-rail-sep" aria-hidden="true" />
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      class="nt-rail-btn"
      :aria-label="`Abrir ${tab.label}${tab.count !== undefined ? `, ${tab.count}` : ''}`"
      @click="selectTab(tab.value); setCollapsed(false)"
    >
      <Icon :name="tab.icon || 'note'" :size="18" />
      <span v-if="tab.count !== undefined" class="nt-rail-count">{{ tab.count }}</span>
    </button>
  </aside>
  <aside v-else class="nt-panel" :aria-label="label || 'Painel'">
    <div class="nt-panel-head">
      <Tabs :items="tabs" :model-value="selectedTab" :label="label" @update:model-value="selectTab" />
      <button type="button" class="nt-icon-btn" aria-label="Recolher painel" @click="setCollapsed(true)">
        <Icon name="collapse" />
      </button>
    </div>
    <div class="nt-panel-body" role="tabpanel">
      <slot v-if="slots[panelSlotName]" :name="panelSlotName" />
      <p v-else-if="typeof panelContent === 'string' || typeof panelContent === 'number'" class="nt-panel-text">
        {{ panelContent }}
      </p>
      <slot v-else />
    </div>
  </aside>
</template>

<style scoped>
.nt-panel {
  display: grid;
  box-sizing: border-box;
  width: 380px;
  max-width: 100%;
  min-height: 0;
  border-left: 1px solid var(--line);
  background: var(--surface);
  grid-template-rows: auto minmax(0, 1fr);
}

.nt-panel-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 8px 8px 0 16px;
  border-bottom: 1px solid var(--line);
}

.nt-panel-head :deep(.nt-tab) {
  margin-bottom: -1px;
}

.nt-icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-bottom: 6px;
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.nt-icon-btn:hover {
  background: var(--sunken);
  color: var(--ink);
}

.nt-icon-btn:focus-visible,
.nt-rail-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.nt-panel-body {
  min-height: 0;
  overflow: auto;
  padding: 20px 24px 48px;
}

.nt-panel-text {
  margin: 0;
  color: var(--ink-2);
}

.nt-rail {
  display: flex;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 48px;
  min-height: 0;
  padding: 10px 0;
  border-left: 1px solid var(--line);
  background: var(--surface);
}

.nt-rail-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.nt-rail-btn:hover {
  background: var(--sunken);
  color: var(--ink);
}

.nt-rail-sep {
  width: 20px;
  height: 1px;
  margin: 4px 0;
  background: var(--line);
}

.nt-rail-count {
  position: absolute;
  top: 1px;
  right: 1px;
  min-width: 14px;
  height: 14px;
  box-sizing: border-box;
  padding: 0 3px;
  border-radius: var(--radius-full);
  background: var(--norte);
  color: var(--on-norte);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 14px;
  text-align: center;
}
</style>
