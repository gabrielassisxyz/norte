<script setup lang="ts">
import { computed, useId } from 'vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import { enabledModuleNames, moduleBacking } from '@/modules/mounting'
import type { ModuleName } from '@/modules/types'

import { useCoreLinks } from './data/composables'
import { registryHref, type CoreLink } from './data/source'

/**
 * Everything saved about one thing.
 *
 * The target id is the only input on purpose: the curriculum and the project
 * screens are the next two places this panel goes, and a panel that knew it
 * was on a subject page would have to learn about each of them in turn.
 */
const props = defineProps<{ targetId: string; title?: string }>()

/**
 * Confirmed `about` links into the target, and nothing else.
 *
 * The filters are the server's: a panel that dropped the suggested rows from
 * the page it was handed would be showing one page of every link, narrowed,
 * and calling it the confirmed ones.
 */
const query = computed(() => ({
  dst_id: props.targetId,
  kind: 'about' as const,
  status: 'confirmed' as const
}))

const { data: page, loading, error, refresh, hasMore, loadingMore, loadMoreError, loadMore } = useCoreLinks(query)

/**
 * Whether an item of this module can be listed: the module is switched on and
 * reads from the API. The registry keeps the rows of a module that has since
 * been switched off, and a link to one of them would open a page that is not
 * there. The core's own items (other subjects) are always there.
 */
function listable(module: string): boolean {
  if (module === 'core') return true
  return enabledModuleNames().includes(module) && moduleBacking(module as ModuleName) === 'api'
}

const links = computed<CoreLink[]>(() => (page.value?.items ?? []).filter((link) => listable(link.src.module)))
// One id per instance: the panel is built to sit on several screens, and two
// of them on one page would otherwise share the id their heading is labelled by.
const titleId = `saved-about-title-${useId()}`
const firstLoad = computed(() => loading.value && page.value === null)
const heading = computed(() => props.title ?? 'Salvos sobre isso')

/** What the row says the item is: its module's own word for its type. */
function kindLabel(link: CoreLink): string {
  return link.src.type
}
</script>

<template>
  <section class="saved-about" :aria-labelledby="titleId">
    <h2 :id="titleId">{{ heading }}</h2>

    <p v-if="firstLoad" class="saved-about-state" role="status">Carregando o que foi salvo…</p>

    <div v-else-if="error" class="saved-about-state" role="alert">
      <p>Não foi possível carregar: {{ error }}</p>
      <Button variant="secondary" @click="refresh()">Tentar de novo</Button>
    </div>

    <p v-else-if="links.length === 0 && !hasMore" class="saved-about-state">Nada salvo sobre isso ainda.</p>

    <ul v-if="!firstLoad && !error && links.length > 0" class="saved-about-list">
      <li v-for="link in links" :key="link.id" class="saved-about-row">
        <RouterLink v-if="registryHref(link.src)" :to="registryHref(link.src)!" class="saved-about-link">
          {{ link.src.title }}
        </RouterLink>
        <span v-else class="saved-about-link is-plain">{{ link.src.title }}</span>
        <span class="saved-about-kind">{{ kindLabel(link) }}</span>
      </li>
    </ul>

    <div v-if="!firstLoad && !error && hasMore" class="saved-about-more">
      <Button variant="secondary" :disabled="loadingMore" @click="loadMore()">
        {{ loadingMore ? 'Carregando…' : 'Carregar mais' }}
      </Button>
      <p v-if="loadMoreError" class="saved-about-state" role="alert">
        Não foi possível carregar mais: {{ loadMoreError }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.saved-about h2 {
  margin: 0 0 var(--space-4);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 26px;
}
.saved-about-state {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 22px;
}
.saved-about-state p {
  margin: 0 0 var(--space-2);
}
.saved-about-more {
  margin-top: var(--space-4);
}
.saved-about-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.saved-about-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 12px var(--space-2);
  border-bottom: 1px solid var(--line);
}
.saved-about-row:hover {
  background: var(--surface);
}
.saved-about-link {
  min-width: 0;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  text-decoration: none;
}
.saved-about-link:hover {
  color: var(--norte);
}
.saved-about-link.is-plain:hover {
  color: var(--ink);
}
.saved-about-link:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.saved-about-kind {
  flex: none;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 20px;
}
</style>
