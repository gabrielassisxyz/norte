<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/ds/Button.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { enabledModuleNames, moduleBacking } from '@/modules/mounting'
import type { ModuleName } from '@/modules/types'
import { useCoreLinks } from '@/shell/data/composables'
import { coreLinksChanged } from '@/shell/data/revision'
import { registryHref, type CoreLink } from '@/shell/data/source'
import { useSources } from '@/sources'

/**
 * The review queue: every destination a model proposed and nobody has decided.
 *
 * Accepting is what finally links the item — the classifier never does, which
 * is the whole point of it writing suggestions. Rejecting keeps the row as the
 * record that the pair was rejected, so the same proposal does not come back
 * on the next classification.
 *
 * The filters are the server's. A panel that dropped the decided rows from the
 * page it was handed would be showing one page of every link, narrowed, and
 * calling it the queue.
 */
const query = { kind: 'about' as const, status: 'suggested' as const }

const { core } = useSources()
const { data: page, loading, error, refresh, hasMore, loadingMore, loadMoreError, loadMore } = useCoreLinks(query)
const deciding = useAsyncAction()

/**
 * Whether an item of this module can be offered: the module is switched on and
 * reads from the API. The registry keeps the rows of a module that has since
 * been switched off, and accepting a suggestion about one of them would link
 * to a page that is not there. The core's own items — subjects — are always
 * there.
 *
 * This narrows the page rather than the query, which the server cannot do: the
 * set of enabled modules is this process's configuration and not a column. It
 * is the same reason the "Saved about this" panel narrows its own page.
 */
function listable(module: string): boolean {
  if (module === 'core') return true
  return enabledModuleNames().includes(module) && moduleBacking(module as ModuleName) === 'api'
}

const suggestions = computed<CoreLink[]>(() =>
  (page.value?.items ?? []).filter((link) => listable(link.src.module) && listable(link.dst.module))
)

const firstLoad = computed(() => loading.value && page.value === null)

/** The model's confidence as a percentage, or nothing when it reported none. */
function confidenceText(link: CoreLink): string {
  if (link.confidence === undefined) return ''
  return `${Math.round(link.confidence * 100)}%`
}

/**
 * Accept or reject one suggestion.
 *
 * The list is not edited here. Deciding a link changes the subject counts and
 * every panel reading them, and none of those can be told anything by this
 * screen, so the revision counter asks them all to read again — this list
 * among them, which is what takes the decided row out of the queue.
 */
async function decide(link: CoreLink, decision: 'accept' | 'reject'): Promise<void> {
  const decided = await deciding.run(() => core.decideLink(link.id, decision))
  if (!decided) return
  coreLinksChanged()
}
</script>

<template>
  <section class="suggestions" aria-labelledby="library-suggestions-title">
    <h2 id="library-suggestions-title">Pending connections</h2>
    <p class="suggestions-intro">
      Connections proposed automatically for what you saved. Nothing is linked without your approval.
    </p>

    <p v-if="deciding.error.value" class="suggestions-error" role="alert">
      Could not decide: {{ deciding.error.value }}
      <button type="button" class="suggestions-clear" @click="deciding.clear()">Close</button>
    </p>

    <p v-if="firstLoad" class="suggestions-state" role="status">Loading the pending connections…</p>

    <div v-else-if="error" class="suggestions-state" role="alert">
      <p>The pending connections could not be loaded: {{ error }}</p>
      <Button variant="secondary" @click="refresh()">Try again</Button>
    </div>

    <p v-else-if="suggestions.length === 0 && !hasMore" class="suggestions-state">
      No pending connection.
    </p>

    <ul v-if="!firstLoad && !error && suggestions.length > 0" class="suggestions-list">
      <li v-for="link in suggestions" :key="link.id" class="suggestion">
        <div class="suggestion-main">
          <RouterLink v-if="registryHref(link.src)" :to="registryHref(link.src)!" class="suggestion-item">
            {{ link.src.title }}
          </RouterLink>
          <span v-else class="suggestion-item is-plain">{{ link.src.title }}</span>
          <p class="suggestion-target">
            <span class="suggestion-target-label">about</span>
            <RouterLink v-if="registryHref(link.dst)" :to="registryHref(link.dst)!" class="suggestion-dst">
              {{ link.dst.title }}
            </RouterLink>
            <span v-else class="suggestion-dst is-plain">{{ link.dst.title }}</span>
            <span v-if="confidenceText(link)" class="suggestion-confidence">{{ confidenceText(link) }}</span>
          </p>
        </div>
        <div class="suggestion-actions" role="group" :aria-label="`Decide ${link.dst.title}`">
          <Button
            variant="primary"
            :disabled="deciding.pending.value"
            :aria-label="`Accept ${link.dst.title}`"
            @click="decide(link, 'accept')"
          >
            Accept
          </Button>
          <Button
            variant="secondary"
            :disabled="deciding.pending.value"
            :aria-label="`Reject ${link.dst.title}`"
            @click="decide(link, 'reject')"
          >
            Reject
          </Button>
        </div>
      </li>
    </ul>

    <div v-if="!firstLoad && !error && hasMore" class="suggestions-more">
      <Button variant="secondary" :disabled="loadingMore" @click="loadMore()">
        {{ loadingMore ? 'Loading…' : 'Load more' }}
      </Button>
      <p v-if="loadMoreError" class="suggestions-state" role="alert">
        Could not load more: {{ loadMoreError }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.suggestions {
  margin-top: 20px;
}
.suggestions h2 {
  margin: 0 0 var(--space-2);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 26px;
}
.suggestions-intro {
  margin: 0 0 var(--space-4);
  max-width: 60ch;
  color: var(--muted);
  font-size: 14px;
  line-height: 22px;
}
.suggestions-state {
  margin: 0;
  padding: 24px 12px;
  color: var(--muted);
  font-size: 15px;
  line-height: 24px;
}
.suggestions-state p {
  margin: 0 0 var(--space-2);
}
.suggestions-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-4);
  color: var(--danger);
  font-size: 13px;
  line-height: 20px;
}
.suggestions-clear {
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 13px;
  cursor: pointer;
}
.suggestions-list {
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
  list-style: none;
}
.suggestion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 14px 12px;
  border-bottom: 1px solid var(--line);
}
.suggestion:hover {
  background: var(--surface);
}
.suggestion-main {
  min-width: 0;
}
.suggestion-item {
  display: block;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  text-decoration: none;
}
.suggestion-item:hover {
  color: var(--norte);
}
.suggestion-item.is-plain:hover {
  color: var(--ink);
}
.suggestion-target {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 20px;
}
.suggestion-target-label {
  color: var(--muted);
}
.suggestion-dst {
  color: var(--norte);
  font-family: var(--font-display);
  font-weight: 550;
  text-decoration: none;
}
.suggestion-dst.is-plain {
  color: var(--ink-2);
}
.suggestion-confidence {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.suggestion-actions {
  display: flex;
  flex: none;
  gap: var(--space-2);
}
.suggestion-item:focus-visible,
.suggestion-dst:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

@media (max-width: 700px) {
  .suggestion {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
