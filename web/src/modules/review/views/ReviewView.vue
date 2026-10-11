<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import Flashcard from '@/components/ds/Flashcard.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import Stat from '@/components/ds/Stat.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { todayIsoDate } from '@/lib/clock'
import type { CardRating, MaterialKind, ReviewCard } from '@/mock/types'
import { useLibraryItem } from '@/modules/library/data/composables'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useSources } from '@/sources'

import { useReviewQueue } from '../data/composables'

const ALL_DECKS = 'all'
const INTERVALS: [string, string, string, string] = ['10 min', '2 d', '6 d', '14 d']
const MATERIAL_KINDS = new Set<MaterialKind>(['article', 'book', 'paper'])

interface SessionRating {
  id: string
  rating: CardRating
}

interface DeckRow {
  id: string
  name: string
  sub: string
  left: number
  total: number
  pct: number
  active: boolean
}

/** A way into another product is offered only while that product is mounted. */
const canReachStudy = computed(() => crossModuleActionAllowed('review', 'study'))
const canReachLibrary = computed(() => crossModuleActionAllowed('review', 'library'))

const { review } = useSources()
const { data: queuePage, loading, error, refresh, applyCard } = useReviewQueue()
const rating = useAsyncAction()

const firstLoad = computed(() => loading.value && queuePage.value === null)
const cards = computed<ReviewCard[]>(() => queuePage.value?.items ?? [])
const decks = computed(() => queuePage.value?.decks ?? [])

// Picking a deck snapshots its due cards into a session queue. A rating is
// written to the source and the card comes back with its new due date, so the
// deck list and the "left today" stat drop while the session queue stays stable.
const pickedId = ref<string | null>(null)
const queue = ref<string[]>([])
const position = ref(0)
const ratings = ref<SessionRating[]>([])

function dueCards(deckId: string): ReviewCard[] {
  const today = todayIsoDate()
  return cards.value.filter((card) => card.dueAt <= today && (deckId === ALL_DECKS || card.deckId === deckId))
}

function progress(due: ReviewCard[], all: ReviewCard[]): { left: number; total: number; pct: number } {
  const total = all.length
  const left = due.length
  return { left, total, pct: total === 0 ? 0 : Math.round(((total - left) / total) * 100) }
}

const deckRows = computed<DeckRow[]>(() => [
  {
    id: ALL_DECKS,
    name: 'Tudo de hoje',
    sub: `${decks.value.length} baralhos`,
    ...progress(dueCards(ALL_DECKS), cards.value),
    active: pickedId.value === ALL_DECKS
  },
  ...decks.value.map((deck) => ({
    id: deck.id,
    name: deck.title,
    sub: deck.description,
    ...progress(
      dueCards(deck.id),
      cards.value.filter((card) => card.deckId === deck.id)
    ),
    active: pickedId.value === deck.id
  }))
])

const currentCard = computed<ReviewCard | undefined>(() => {
  const id = queue.value[position.value]
  if (id === undefined) return undefined
  return cards.value.find((card) => card.id === id)
})

const finished = computed(() => pickedId.value !== null && currentCard.value === undefined)

const leftToday = computed(() => queuePage.value?.counts.due ?? 0)

const doneCount = computed(() => ratings.value.length)

const recalled = computed(() => {
  const total = ratings.value.length
  if (total === 0) return '–'
  const remembered = ratings.value.filter((entry) => entry.rating === 'good' || entry.rating === 'easy').length
  return String(Math.round((remembered / total) * 100))
})

const cardDeck = computed(() => decks.value.find((deck) => deck.id === currentCard.value?.deckId)?.title ?? '')

/** The card's source material belongs to the library, so the library answers for it. */
const sourceId = computed(() => currentCard.value?.sourceLibraryItemId ?? '')
const sourceEnabled = computed(() => canReachLibrary.value && sourceId.value !== '')
const { data: sourceItem } = useLibraryItem(sourceId, sourceEnabled)

function isMaterialKind(kind: string): boolean {
  return MATERIAL_KINDS.has(kind as MaterialKind)
}

// Reading material opens on its own screen; anything else (video, podcast,
// course) falls back to the library, like the home screen does.
const sourceTo = computed(() => {
  const item = sourceItem.value
  if (item && isMaterialKind(item.kind)) return `/material/${item.kind}/${item.id}`
  return { name: 'library', query: { v: 'all' } }
})

const cardCountLabel = computed(() => (doneCount.value === 1 ? 'cartão' : 'cartões'))

function pick(id: string): void {
  pickedId.value = id
  queue.value = dueCards(id).map((card) => card.id)
  position.value = 0
  ratings.value = []
}

/**
 * A rating moves on only once the source has taken it. If it fails the card
 * stays in front of the reader with the reason, because advancing past a card
 * nobody recorded loses the answer the reader just gave.
 */
async function rate(value: CardRating): Promise<void> {
  const id = queue.value[position.value]
  if (id === undefined) return
  const rated = await rating.run(() => review.rateCard(id, value))
  if (!rated) return
  applyCard(rated)
  ratings.value.push({ id, rating: value })
  position.value += 1
}

function restart(): void {
  pickedId.value = null
  queue.value = []
  position.value = 0
  ratings.value = []
}
</script>

<template>
  <main class="review">
    <div class="review-top">
      <nav class="crumb" aria-label="Navegação estrutural">
        <template v-if="canReachStudy">
          <RouterLink :to="{ name: 'estudo' }">Estudo</RouterLink>
          <span aria-hidden="true">/</span>
        </template>
        <span class="crumb-current">Revisão</span>
      </nav>
      <div v-if="pickedId !== null" class="review-actions">
        <Button variant="secondary" @click="restart">Reiniciar sessão</Button>
      </div>
    </div>

    <div class="review-hero">
      <PageTitle
        title="Revisão"
        objective="Lembrar o que li, não só reconhecer. Responda de memória antes de virar o cartão."
      />
    </div>

    <div class="review-stats">
      <Stat :value="leftToday" unit="cartões" label="Restam hoje" />
      <Stat :value="doneCount" label="Revisados nesta sessão" />
      <Stat :value="recalled" unit="%" label="Lembrados" />
    </div>

    <p v-if="rating.error.value" class="review-write-error" role="alert">
      Não foi possível registrar a resposta: {{ rating.error.value }}
    </p>

    <p v-if="firstLoad" class="review-state" role="status">Carregando os cartões…</p>

    <div v-else-if="error" class="review-state" role="alert">
      <p>Não foi possível carregar os cartões: {{ error }}</p>
      <Button variant="secondary" @click="refresh()">Tentar de novo</Button>
    </div>

    <div v-else-if="cards.length === 0" class="review-state">
      <p>Nenhum cartão ainda. Os cartões nascem do que você lê e marca.</p>
    </div>

    <div v-else class="review-page">
      <div class="review-main">
        <template v-if="currentCard">
          <Flashcard
            :key="currentCard.id"
            :deck="cardDeck"
            :position="`${position + 1}/${queue.length}`"
            :front="currentCard.front"
            :back="currentCard.back"
            :intervals="INTERVALS"
            @rate="rate"
          />
          <p class="review-hint">
            Espaço vira o cartão · <span class="mono">1</span> a <span class="mono">4</span> avaliam ·
            origem:
            <RouterLink v-if="canReachLibrary" :to="sourceTo">{{ sourceItem?.title ?? 'Biblioteca' }}</RouterLink>
            <span v-else>{{ sourceItem?.title ?? 'Biblioteca' }}</span>
          </p>
        </template>

        <section v-else-if="finished" class="review-panel" aria-labelledby="review-finish-title">
          <h2 id="review-finish-title" class="sec-title">Sessão concluída</h2>
          <p v-if="doneCount > 0" class="review-text">
            Você revisou <span class="mono">{{ doneCount }} {{ cardCountLabel }}</span> e lembrou
            de <span class="mono">{{ recalled }}%</span>. Os marcados como “De novo” voltam em 10
            minutos; os demais reaparecem na próxima sessão.
          </p>
          <p v-else class="review-text">Não havia cartões vencidos neste baralho.</p>
          <div class="review-panel-actions">
            <Button variant="primary" @click="restart">Revisar de novo</Button>
            <RouterLink :to="{ name: 'inicio' }" class="review-home">Voltar ao início</RouterLink>
          </div>
        </section>

        <section v-else class="review-panel" aria-labelledby="review-pick-title">
          <h2 id="review-pick-title" class="sec-title">Escolha um baralho</h2>
          <p class="review-text">
            Os cartões vencidos hoje estão nos baralhos ao lado. Escolha um para começar a
            sessão — ou comece por tudo de uma vez.
          </p>
          <div class="review-panel-actions">
            <Button variant="primary" @click="pick(ALL_DECKS)">Começar tudo de hoje</Button>
          </div>
        </section>
      </div>

      <aside class="review-side" aria-label="Baralhos">
        <div>
          <div class="review-decks-head">
            <h2 class="sec-title sec-title-sm">Baralhos</h2>
            <span class="mono review-today">hoje</span>
          </div>
          <div class="review-decks">
            <button
              v-for="deck in deckRows"
              :key="deck.id"
              type="button"
              :class="['deck', { 'is-on': deck.active }]"
              :aria-pressed="deck.active ? 'true' : 'false'"
              @click="pick(deck.id)"
            >
              <span class="deck-main">
                <span class="deck-t">{{ deck.name }}</span>
                <span class="deck-sub">{{ deck.sub }}</span>
              </span>
              <span class="mono deck-count">{{ deck.left }} / {{ deck.total }}</span>
              <span class="deck-track"><span class="deck-fill" :style="{ width: `${deck.pct}%` }" /></span>
            </button>
          </div>
        </div>
        <div class="review-about">
          <span class="review-about-title">Como os intervalos são calculados</span>
          <p>
            Os intervalos seguem repetição espaçada: “Bom” mantém o ritmo, “Fácil” estica,
            “Difícil” encurta e “De novo” traz o cartão de volta em 10 minutos.
          </p>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.review-state { margin: var(--space-6) 0 0; color: var(--muted); font-size: 15px; line-height: 24px; }
.review-state p { margin: 0 0 var(--space-2); }
.review-write-error { margin: var(--space-4) 0 0; color: var(--danger); font-size: 13px; line-height: 20px; }

.review {
  max-width: 1120px;
  margin: 0 auto;
}

.review-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 20px;
  font-weight: 550;
  color: var(--muted);
}

.crumb a {
  color: var(--muted);
  text-decoration: none;
}

.crumb a:hover {
  color: var(--ink);
}

.crumb-current {
  color: var(--ink);
}

.review-actions {
  display: flex;
  gap: 12px;
}

.review-hero {
  padding-top: 72px;
}

.review-stats {
  display: flex;
  gap: 48px;
  margin-top: 40px;
  padding: 20px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}

.review-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 64px;
  align-items: start;
  margin-top: 56px;
}

.review-main {
  min-width: 0;
}

.review-hint {
  margin: 16px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
  max-width: 640px;
}

.review-panel {
  max-width: 640px;
  box-sizing: border-box;
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  display: grid;
  gap: 16px;
}

.review-text {
  margin: 0;
  font-size: 16px;
  line-height: 26px;
  color: var(--ink-2);
  max-width: 60ch;
  text-wrap: pretty;
}

.review-panel-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.review-home {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 16px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
}

.review-home:hover {
  background: var(--sunken);
}

.sec-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 30px;
  font-weight: 650;
  letter-spacing: -0.015em;
  color: var(--ink);
}

.sec-title-sm {
  font-size: 17px;
  line-height: 24px;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.review-side {
  display: grid;
  gap: 28px;
  align-content: start;
}

.review-decks-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.review-today {
  font-size: 12px;
  color: var(--muted);
}

.review-decks {
  border-top: 1px solid var(--line);
}

.deck {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 120px 72px;
  gap: 24px;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 14px 12px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.deck:hover {
  background: var(--surface);
}

.deck:hover .deck-t,
.deck.is-on .deck-t {
  color: var(--norte);
}

.deck-main {
  min-width: 0;
}

.deck-t {
  display: block;
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.deck-sub {
  display: block;
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.deck-count {
  font-size: 13px;
  color: var(--ink-2);
  text-align: right;
}

.deck-track {
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--sunken);
  box-shadow: inset 0 0 0 1px var(--line);
  overflow: hidden;
}

.deck-fill {
  display: block;
  height: 100%;
  background: var(--norte);
}

.review-about {
  display: grid;
  gap: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}

.review-about-title {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
  color: var(--muted);
}

.review-about p {
  margin: 0;
  text-wrap: pretty;
}

@media (max-width: 900px) {
  .review-page {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
