<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

export type Rating = 'again' | 'hard' | 'good' | 'easy'

const props = withDefaults(
  defineProps<{
    deck?: string
    position?: string
    front: string
    back: string
    revealed?: boolean
    intervals?: [string, string, string, string]
  }>(),
  {
    revealed: false,
    intervals: () => ['1m', '6m', '1d', '4d'] as [string, string, string, string]
  }
)

const emit = defineEmits<{ reveal: []; rate: [rating: Rating] }>()

const RATINGS: { value: Rating; label: string }[] = [
  { value: 'again', label: 'Again' },
  { value: 'hard', label: 'Hard' },
  { value: 'good', label: 'Good' },
  { value: 'easy', label: 'Easy' }
]

const shown = ref(props.revealed)

function reveal(): void {
  if (shown.value) return
  shown.value = true
  emit('reveal')
}

function rate(rating: Rating): void {
  emit('rate', rating)
}

// Reviewing is a keyboard loop: space to reveal, 1-4 to grade without leaving the home row.
function onKeydown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (!shown.value) {
    if (event.key !== ' ' && event.key !== 'Spacebar') return
    event.preventDefault()
    reveal()
    return
  }
  const slot = Number(event.key)
  if (!Number.isInteger(slot) || slot < 1 || slot > RATINGS.length) return
  event.preventDefault()
  rate(RATINGS[slot - 1].value)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="nt-card" aria-label="Flashcard">
    <div class="nt-card-head">
      <span>{{ deck }}</span>
      <span v-if="position" class="nt-card-pos">{{ position }}</span>
    </div>
    <div class="nt-card-front">{{ front }}</div>
    <template v-if="shown">
      <div class="nt-card-back">{{ back }}</div>
      <div class="nt-card-rate">
        <button
          v-for="(rating, i) in RATINGS"
          :key="rating.value"
          type="button"
          class="nt-rate"
          :class="`nt-rate-${rating.value}`"
          @click="rate(rating.value)"
        >
          <span class="nt-rate-label">{{ rating.label }}</span>
          <span class="nt-rate-iv">{{ intervals[i] }}</span>
        </button>
      </div>
    </template>
    <div v-else class="nt-card-reveal">
      <button type="button" class="nt-btn nt-btn-primary nt-btn-md" @click="reveal">
        Show answer
      </button>
      <span class="nt-kbd">space</span>
    </div>
  </section>
</template>

<style scoped>
.nt-card {
  max-width: 640px;
  box-sizing: border-box;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-6);
}
.nt-card-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  line-height: 16px;
  color: var(--muted);
}
.nt-card-pos {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.nt-card-front {
  margin: var(--space-6) 0;
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 30px;
  font-weight: 650;
  letter-spacing: -0.015em;
  color: var(--ink);
  text-wrap: balance;
}
/* The README asks for a crossfade, never a 3D flip. */
.nt-card-back {
  padding-top: var(--space-6);
  border-top: 1px solid var(--line);
  font-size: 16px;
  line-height: 26px;
  color: var(--ink-2);
  max-width: 65ch;
  animation: nt-card-fade 200ms cubic-bezier(0.2, 0, 0, 1);
}
@keyframes nt-card-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.nt-card-reveal {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.nt-kbd {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 16px;
  color: var(--muted);
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xs);
}
.nt-card-rate {
  margin-top: var(--space-6);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
}
.nt-rate {
  display: grid;
  gap: 2px;
  justify-items: center;
  padding: var(--space-2) 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1);
}
.nt-rate:hover {
  background: var(--sunken);
}
.nt-rate-label {
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 20px;
  font-weight: 550;
}
.nt-rate-iv {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.nt-rate-again .nt-rate-label {
  color: var(--danger);
}
.nt-rate-good {
  background: var(--norte);
  border-color: var(--norte);
  color: var(--on-norte);
}
.nt-rate-good:hover {
  background: var(--norte-hover);
}
.nt-rate-good .nt-rate-iv {
  color: var(--on-norte);
}
.nt-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 20px;
  font-weight: 550;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1);
}
.nt-btn-md {
  height: 36px;
  padding: 0 var(--space-4);
}
.nt-btn-primary {
  background: var(--norte);
  color: var(--on-norte);
}
.nt-btn-primary:hover {
  background: var(--norte-hover);
}
.nt-btn:focus-visible,
.nt-rate:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
</style>
