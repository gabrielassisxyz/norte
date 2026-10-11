<script setup lang="ts">
import { Comment, Fragment, computed, onBeforeUnmount, onMounted, ref, useSlots, type VNode } from 'vue'

import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    itemWidth?: number
    gap?: number
    visible?: number
    step?: number
    arrowTop?: number
    label?: string
  }>(),
  { itemWidth: 248, gap: 24, visible: 4, step: 2, arrowTop: 64, label: 'Carousel' }
)

const slots = useSlots()

/** A v-for in the parent arrives as a single Fragment, so the real items are one level down. */
function flatten(nodes: VNode[]): VNode[] {
  return nodes.flatMap((node) => {
    if (node.type === Fragment) return flatten((node.children ?? []) as VNode[])
    return node.type === Comment ? [] : [node]
  })
}

const items = computed(() => flatten(slots.default?.() ?? []))

const viewport = ref<HTMLElement | null>(null)
const width = ref(0)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !viewport.value) return
  observer = new ResizeObserver((entries) => {
    width.value = entries[0].contentRect.width
  })
  observer.observe(viewport.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

// Narrow viewports show fewer than `visible` items, so the end of the track moves with them.
const perView = computed(() => {
  if (width.value <= 0) return props.visible
  const fits = Math.floor((width.value + props.gap) / (props.itemWidth + props.gap))
  return Math.max(1, Math.min(props.visible, fits))
})

const maxIndex = computed(() => Math.max(0, items.value.length - perView.value))
const rawIndex = ref(0)
const index = computed(() => Math.min(rawIndex.value, maxIndex.value))

const offset = computed(() => index.value * (props.itemWidth + props.gap))

function prev(): void {
  rawIndex.value = Math.max(0, index.value - props.step)
}

function next(): void {
  rawIndex.value = Math.min(maxIndex.value, index.value + props.step)
}
</script>

<template>
  <div class="nt-carousel" role="region" :aria-label="label">
    <div ref="viewport" class="nt-carousel-viewport">
      <div
        class="nt-carousel-track"
        :style="{ gap: `${gap}px`, transform: `translateX(-${offset}px)` }"
      >
        <div
          v-for="(node, i) in items"
          :key="i"
          class="nt-carousel-item"
          :style="{ flex: `0 0 ${itemWidth}px` }"
        >
          <component :is="node" />
        </div>
      </div>
    </div>
    <button
      type="button"
      class="nt-carousel-btn is-prev"
      :style="{ top: `${arrowTop}px` }"
      :disabled="index === 0"
      aria-label="Previous"
      @click="prev"
    >
      <Icon name="arrowLeft" />
    </button>
    <button
      type="button"
      class="nt-carousel-btn is-next"
      :style="{ top: `${arrowTop}px` }"
      :disabled="index >= maxIndex"
      aria-label="Next"
      @click="next"
    >
      <Icon name="arrow" />
    </button>
  </div>
</template>

<style scoped>
.nt-carousel {
  position: relative;
  /* The arrows overflow on purpose, so the track's width must not push the container wider. */
  min-width: 0;
}
.nt-carousel-viewport {
  overflow: hidden;
  margin: -4px;
  padding: 4px;
}
.nt-carousel-track {
  display: flex;
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
}
.nt-carousel-btn {
  position: absolute;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  box-shadow: var(--shadow-pop);
}
.nt-carousel-btn:hover {
  background: var(--sunken);
}
/* An arrow with nowhere to go leaves the frame entirely rather than sitting there greyed out. */
.nt-carousel-btn:disabled {
  opacity: 0;
  pointer-events: none;
}
.nt-carousel-btn:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.nt-carousel-btn.is-prev {
  left: -20px;
}
.nt-carousel-btn.is-next {
  right: -20px;
}

/*
  The arrows hang 20px outside the track on purpose, which a wide screen has the
  margin for. A phone does not: the content column is 16px from the edge, so an
  arrow placed there is 4px past the viewport and the whole document scrolls
  sideways. Inside the frame on a phone, over the first and last card.
*/
@media (max-width: 900px) {
  .nt-carousel-btn.is-prev {
    left: 0;
  }

  .nt-carousel-btn.is-next {
    right: 0;
  }
}
</style>
