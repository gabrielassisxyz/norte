<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/ds/Button.vue'
import Icon from '@/components/ds/Icon.vue'
import Mark from '@/components/ds/Mark.vue'
import ProgressBar from '@/components/ds/ProgressBar.vue'
import SelectionToolbar from '@/components/ds/SelectionToolbar.vue'
import type { MaterialKind } from '@/mock/types'

import ArticleContent from '../../components/ArticleContent.vue'
import type { LibraryItemRecord } from '../../data/source'

const props = defineProps<{
  kind: MaterialKind
  material: LibraryItemRecord
  highlightedQuote?: string
  /** The selection actions the reader is allowed to offer. */
  selectionActions?: string[]
}>()

const emit = defineEmits<{
  selectionAction: [payload: { action: string; text: string }]
  goExercises: []
}>()

const selectionTarget = ref<HTMLElement>()
const localSelection = ref('')
const bookTextSize = ref<'normal' | 'large'>('normal')
const bookContentsOpen = ref(false)
const bookPageMarked = ref(false)
const paperPage = ref(1)
const paperZoom = ref(100)
const paperSectionsOpen = ref(false)
const citationCopied = ref(false)

const kindLabel = computed(() => {
  if (props.kind === 'book') return 'Book'
  if (props.kind === 'paper') return 'Paper'
  return 'Post'
})

const sourceHost = computed(() => props.material.url.replace(/^https?:\/\//, '').split('/')[0] || 'local source')

function handleSelection(): void {
  if (props.kind !== 'article') return
  const selection = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : ''
  if (!selection) return
  localSelection.value = selection
}

function handleSelectionAction(action: string): void {
  if (!localSelection.value) return
  const text = localSelection.value
  emit('selectionAction', { action, text })
  localSelection.value = ''
  if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges()
}

function changeBookTextSize(): void {
  bookTextSize.value = bookTextSize.value === 'normal' ? 'large' : 'normal'
}

function changePaperPage(delta: number): void {
  paperPage.value = Math.max(1, Math.min(29, paperPage.value + delta))
}

function changePaperZoom(delta: number): void {
  paperZoom.value = Math.max(80, Math.min(140, paperZoom.value + delta))
}

async function copyCitation(): Promise<void> {
  citationCopied.value = true
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(`${props.material.author ?? props.material.site ?? ''}. ${props.material.title}.`)
  }
}
</script>

<template>
  <article v-if="kind === 'article'" class="material-reader reader-post" aria-label="Article reader">
    <div class="content-grid reader-heading">
      <div class="reader-copy">
        <div class="material-meta">
          <span class="material-mono">{{ sourceHost }}</span>
          <span>{{ kindLabel }}</span>
          <span>~8 min read</span>
        </div>
        <h1 class="reader-title">{{ material.title }}</h1>
        <p class="reader-byline">
          {{ material.author ?? material.site }} ·
          <a :href="material.url" target="_blank" rel="noreferrer">Open the original</a>
        </p>
        <div class="reader-rule" />
      </div>
      <div class="margin" />
    </div>

    <div class="reader-prose">
      <div class="content-grid prose-row">
        <!--
          The article is the server's extracted text, so the selection anchor
          wraps the whole of it rather than one sentence: a highlight can start
          anywhere a reader puts the cursor.
        -->
        <span class="selection-anchor">
          <span ref="selectionTarget" class="selection-target" data-selection-target @mouseup="handleSelection">
            <ArticleContent :html="material.content_html" />
          </span>
          <SelectionToolbar
            v-if="localSelection && (props.selectionActions?.length ?? 1) > 0"
            class="selection-toolbar"
            :actions="props.selectionActions"
            @action="handleSelectionAction"
          />
        </span>
        <div class="margin" />
      </div>
      <div class="content-grid prose-row prose-ending">
        <div class="reader-ending">
          <span>End of the article</span>
          <Button variant="primary" @click="emit('goExercises')">Go to the exercises</Button>
        </div>
        <div class="margin" />
      </div>
    </div>
  </article>

  <section v-else-if="kind === 'book'" class="material-reader reader-book" aria-label="Book reader">
    <h1 class="reader-book-title visually-hidden">{{ material.title }}</h1>
    <div class="reader-toolbar">
      <div class="reader-toolbar-start">
        <button type="button" class="reader-tool reader-tool-with-label" @click="bookContentsOpen = !bookContentsOpen">
          <Icon name="note" />
          Contents
        </button>
        <span class="reader-cover" aria-hidden="true" />
        <div class="reader-work-title">
          <strong>{{ material.title }}</strong>
          <span>{{ material.author ?? material.site }} · Book</span>
        </div>
      </div>
      <div class="reader-toolbar-actions">
        <button type="button" class="reader-tool" aria-label="Typography" :aria-pressed="bookTextSize === 'large'" @click="changeBookTextSize">Aa</button>
        <button type="button" class="reader-tool" aria-label="Bookmark this page" :aria-pressed="bookPageMarked" @click="bookPageMarked = !bookPageMarked">
          <Icon name="note" :class="{ 'is-marked': bookPageMarked }" />
        </button>
      </div>
    </div>
    <div v-if="bookContentsOpen" class="book-contents" aria-label="Contents">
      <strong>Contents</strong>
      <button type="button" class="book-contents-link">1. Attention and context</button>
      <button type="button" class="book-contents-link is-current">2. Watching your own reading</button>
      <button type="button" class="book-contents-link">3. Practicing with intervals</button>
    </div>

    <div class="book-page-scroll">
      <div class="content-grid reader-heading">
        <div class="reader-copy">
          <div class="material-mono chapter-label">Chapter 2</div>
          <div class="reader-rule" />
        </div>
        <div class="margin" />
      </div>
      <div class="content-grid book-row">
        <div class="book-page" :class="{ 'is-large': bookTextSize === 'large' }">
          <p class="book-lead">Reading closely means noticing when one idea starts leaning on another.</p>
          <p>
            Understanding does not arrive the moment we recognize a sentence. It shows when
            we can anticipate the next question, explain a relation, and notice where
            uncertainty remains.
          </p>
          <p>
            So it pays to separate two things: <Mark :note="1">understanding a passage and knowing that we understood it</Mark>.
            The first can happen through familiarity; the second needs a recall
            attempt that shows what stays available without the text.
          </p>
          <p>
            A simple practice is to close the page at the end of a section and write three sentences
            from memory. What stayed clear, what stayed fragile, and which example could argue against the idea?
          </p>
          <p>
            The record does not need to be perfect. It only needs to make visible the difference between an
            impression of fluency and a memory that can guide a decision.
          </p>
          <div class="page-number material-mono">87</div>
        </div>
        <div class="margin"><div class="margin-note"><span>1</span><span>A short question reveals more than rereading the whole page.</span></div></div>
      </div>
    </div>
    <div class="reader-footer">
      <button type="button" class="reader-tool" aria-label="Previous page" disabled>‹</button>
      <ProgressBar :value="87" :max="304" />
      <span class="material-mono page-progress">p. 87 of 304</span>
      <span class="reader-footer-hint">~14 min to the end of the chapter</span>
      <button type="button" class="reader-tool" aria-label="Next page">›</button>
    </div>
  </section>

  <section v-else class="material-reader reader-paper" aria-label="Paper reader">
    <div class="reader-toolbar">
      <div class="reader-toolbar-start">
        <button type="button" class="reader-tool reader-tool-with-label" @click="paperSectionsOpen = !paperSectionsOpen">
          <Icon name="note" />
          Sections
        </button>
        <span class="reader-divider" aria-hidden="true" />
        <button type="button" class="reader-tool" aria-label="Previous page" :disabled="paperPage === 1" @click="changePaperPage(-1)">‹</button>
        <span class="material-mono page-count">{{ paperPage }} / 29</span>
        <button type="button" class="reader-tool" aria-label="Next page" :disabled="paperPage === 29" @click="changePaperPage(1)">›</button>
        <span class="reader-divider" aria-hidden="true" />
        <button type="button" class="reader-tool" aria-label="Zoom out" :disabled="paperZoom === 80" @click="changePaperZoom(-10)">−</button>
        <span class="material-mono page-count">{{ paperZoom }}%</span>
        <button type="button" class="reader-tool" aria-label="Zoom in" :disabled="paperZoom === 140" @click="changePaperZoom(10)">+</button>
      </div>
      <div class="reader-toolbar-actions">
        <button type="button" class="reader-tool reader-copy-citation" @click="copyCitation">{{ citationCopied ? 'Quotation copied' : 'Copy the quotation' }}</button>
        <a class="reader-tool reader-link" :href="material.url" target="_blank" rel="noreferrer">Original PDF <Icon name="external" :size="14" /></a>
      </div>
    </div>
    <div v-if="paperSectionsOpen" class="paper-sections" aria-label="Paper sections">
      <button type="button" class="book-contents-link is-current">Abstract</button>
      <button type="button" class="book-contents-link">Method</button>
      <button type="button" class="book-contents-link">Discussion</button>
    </div>
    <div class="paper-page-scroll">
      <div class="paper-pages">
        <article class="paper-page" aria-label="Page 1">
          <div class="paper-kicker material-mono">Research notebook · 2025 · Vol. 12</div>
          <h1>{{ material.title }}</h1>
          <p class="paper-authors">{{ material.author ?? material.site }}</p>
          <div class="paper-abstract">
            <strong>Abstract</strong>
            <p>A study of how short records, predictions, and repeated reviews help turn a reading into usable knowledge.</p>
          </div>
          <div class="paper-columns">
            <div>
              <h2>Introduction</h2>
              <p>Quick explanations tend to mix observation, memory, and expectation. Separating those layers lets you test an interpretation before treating it as fact.</p>
              <p><Mark :note="1">Records that predict an outcome can be compared later</Mark> and refined with little infrastructure.</p>
            </div>
            <div>
              <p>The proposed method combines a clear question, a recall attempt, and a review of what happened. The sequence leaves a trail that other sessions can pick up.</p>
              <p>The most important result is not a final answer, but a sharper hypothesis about the next step.</p>
            </div>
          </div>
          <div class="page-number material-mono">1</div>
        </article>
        <div class="margin paper-margin" aria-label="Margin notes">
          <div class="margin-note"><span>1</span><span>An explicit prediction helps separate memory from expectation.</span></div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.material-reader {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--ground);
}

.content-grid,
.paper-pages {
  display: grid;
  grid-template-columns: minmax(0, 640px) 200px;
  gap: 40px;
  justify-content: center;
  padding-right: 32px;
  padding-left: 32px;
}

.reader-heading {
  padding-top: 56px;
}

.reader-copy {
  min-width: 0;
}

.material-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
}

.material-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.reader-title {
  margin: 16px 0 0;
  font-family: var(--font-display);
  font-size: 40px;
  line-height: 44px;
  font-weight: 700;
  letter-spacing: -0.03em;
  text-wrap: balance;
}

.reader-byline {
  margin: 12px 0 0;
  color: var(--ink-2);
  font-size: 15px;
  line-height: 24px;
}

.reader-byline a,
.reader-link {
  color: var(--link);
}

.reader-rule {
  height: 1px;
  margin: 36px 0 40px;
  background: var(--line);
}

.reader-prose {
  padding-bottom: 80px;
}

.prose-row {
  align-items: start;
}

.prose-row p,
.book-page p,
.paper-page p {
  margin: 0 0 24px;
  color: var(--ink);
  font-size: 18px;
  line-height: 30px;
}

.prose-row h2 {
  margin: 16px 0;
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 30px;
  font-weight: 650;
  letter-spacing: -0.015em;
}

.margin {
  min-width: 0;
}

.margin-note {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 6px;
  padding-top: 6px;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 20px;
}

.margin-note > span:first-child {
  color: var(--norte);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.selection-anchor {
  position: relative;
  display: inline;
}

.selection-target {
  border-radius: 2px;
}

.selection-toolbar {
  position: absolute;
  z-index: 3;
  bottom: calc(100% + 10px);
  left: 0;
}

.prose-ending {
  padding-bottom: 32px;
}

.reader-ending {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
}

.reader-toolbar {
  position: sticky;
  z-index: 2;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--ground) 94%, transparent);
}

.reader-book-title {
  margin: 0;
}

.reader-toolbar-start,
.reader-toolbar-actions {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 4px;
}

.reader-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  text-decoration: none;
  white-space: nowrap;
}

.reader-tool:hover:not(:disabled) {
  background: var(--sunken);
  color: var(--ink);
}

.reader-tool:disabled {
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.55;
}

.reader-tool:focus-visible,
.book-contents-link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.reader-tool-with-label {
  padding-right: 10px;
  padding-left: 6px;
}

.reader-cover {
  width: 24px;
  height: 34px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: 2px;
  background: var(--sunken);
}

.reader-work-title {
  display: grid;
  min-width: 0;
  margin-left: 4px;
}

.reader-work-title strong,
.reader-work-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reader-work-title strong {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 20px;
}

.reader-work-title span {
  color: var(--muted);
  font-size: 12px;
  line-height: 16px;
}

.book-contents,
.paper-sections {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 13px;
}

.book-contents-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  font: inherit;
}

.book-contents-link:hover,
.book-contents-link.is-current {
  color: var(--norte);
}

.book-page-scroll,
.paper-page-scroll {
  min-height: 0;
}

.chapter-label {
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
}

.book-page-scroll .reader-rule {
  margin: 20px 0 32px;
}

.book-row {
  padding-bottom: 72px;
}

.book-page {
  min-width: 0;
}

.book-page.is-large p {
  font-size: 20px;
  line-height: 33px;
}

.book-page .book-lead {
  text-indent: 0;
  font-family: var(--font-display);
  font-size: 20px;
  line-height: 30px;
  font-weight: 600;
}

.page-number {
  margin-top: 28px;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
}

.reader-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  border-top: 1px solid var(--line);
  background: var(--ground);
}

.reader-footer :deep(.nt-progress) {
  flex: 1;
  min-width: 80px;
}

.page-progress,
.reader-footer-hint {
  color: var(--ink-2);
  font-size: 13px;
  white-space: nowrap;
}

.reader-footer-hint {
  color: var(--muted);
}

.reader-divider {
  width: 1px;
  height: 20px;
  background: var(--line);
}

.page-count {
  color: var(--ink-2);
  font-size: 13px;
}

.reader-paper {
  position: relative;
}

.paper-pages {
  padding-top: 28px;
  padding-bottom: 72px;
}

.paper-page {
  min-width: 0;
}

.paper-kicker {
  color: var(--muted);
  font-size: 11px;
  line-height: 16px;
}

.paper-page h1 {
  margin: 24px 0 0;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 31px;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-wrap: balance;
}

.paper-page .paper-authors {
  margin: 12px 0 0;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 22px;
}

.paper-abstract {
  margin: 28px 0;
  padding: 16px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.paper-abstract strong {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 16px;
}

.paper-abstract p {
  margin: 6px 0 0;
  color: var(--ink-2);
  font-size: 13.5px;
  line-height: 21px;
}

.paper-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
}

.paper-columns h2 {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 24px;
}

.paper-columns p {
  font-size: 15px;
  line-height: 24px;
  text-indent: 1.5em;
}

.paper-columns h2 + p {
  text-indent: 0;
}

.paper-margin {
  padding-top: 178px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .content-grid,
  .paper-pages {
    grid-template-columns: minmax(0, 680px);
  }

  .content-grid > .margin,
  .paper-pages > .margin {
    display: none;
  }
}

@media (max-width: 860px) {
  .material-reader {
    overflow: visible;
  }

  .content-grid,
  .paper-pages {
    grid-template-columns: minmax(0, 1fr);
    padding-right: 16px;
    padding-left: 16px;
  }

  .reader-heading {
    padding-top: 32px;
  }

  .reader-title {
    font-size: 32px;
    line-height: 36px;
  }

  .reader-toolbar {
    position: static;
    padding: 8px 16px;
  }

  .reader-work-title,
  .reader-footer-hint,
  .reader-copy-citation {
    display: none;
  }

  .book-contents,
  .paper-sections {
    flex-wrap: wrap;
    padding-right: 16px;
    padding-left: 16px;
  }

  .reader-footer {
    padding-right: 16px;
    padding-left: 16px;
  }

  .paper-pages {
    padding-top: 16px;
  }

  .paper-columns {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}
</style>
