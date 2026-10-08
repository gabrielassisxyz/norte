<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * The extracted article, inserted as HTML.
 *
 * `v-html` is correct here and nowhere else in the app: the server sanitized
 * this markup against an allowlist before storing it, so the component adds no
 * sanitizer of its own — two of them would disagree, and the one that matters
 * is the one the server will still be applying to a snapshot taken last year.
 *
 * Images are fetched by the browser straight from the host that served the
 * article. That is a request the reading leaks to a third party, and it is
 * accepted deliberately: the alternative is proxying every image through the
 * server, which is worth building only if privacy or a dead host makes it
 * necessary rather than merely conceivable.
 */
const props = defineProps<{ html?: string }>()

/**
 * Said once per render, with the element the markup now lives in.
 *
 * A reader action that decorates the text — wrapping a highlighted passage, for
 * one — has nothing to hook without it: `v-html` replaces the whole subtree, so
 * every node such a decoration touched is gone by the time the new markup is
 * on the page, and it has to be applied again rather than once.
 */
const emit = defineEmits<{ rendered: [root: HTMLElement] }>()

const host = ref<HTMLElement>()

/** Every `error` listener this component installed, so each one can come off. */
let installed: Array<{ image: HTMLImageElement; handler: EventListener }> = []

function removeInstalledListeners(): void {
  for (const entry of installed) entry.image.removeEventListener('error', entry.handler)
  installed = []
}

/**
 * Whether a link leaves the app.
 *
 * An in-page anchor (`#section`) and a relative path are the article pointing
 * at itself; everything on another origin is a new tab, which also means the
 * reading position is not lost to a click.
 */
function leavesTheApp(href: string): boolean {
  try {
    const target = new URL(href, window.location.href)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
    return target.origin !== window.location.origin
  } catch {
    return false
  }
}

/**
 * An image that did not load is replaced by what it was described as.
 *
 * A broken image icon in the middle of a paragraph says nothing; the `alt` the
 * extraction kept says what the reader is missing.
 */
function replaceWithAltText(image: HTMLImageElement): void {
  const described = image.getAttribute('alt')?.trim()
  const replacement = document.createElement('span')
  replacement.className = 'article-image-failed'
  replacement.textContent = described && described.length > 0 ? described : 'Imagem indisponível'
  installed = installed.filter((entry) => entry.image !== image)
  image.replaceWith(replacement)
}

/**
 * What plain insertion cannot do, done once per value of `content_html`.
 *
 * The walk runs after Vue has replaced the markup, and the listeners of the
 * previous value come off first: the nodes they were bound to are gone, and a
 * second extraction of the same article would otherwise leave one handler per
 * render behind.
 */
function decorate(): void {
  removeInstalledListeners()
  const root = host.value
  if (!root) return

  for (const link of root.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') ?? ''
    if (!leavesTheApp(href)) continue
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }

  for (const image of root.querySelectorAll('img')) {
    image.setAttribute('loading', 'lazy')
    const handler = (): void => replaceWithAltText(image)
    image.addEventListener('error', handler)
    installed.push({ image, handler })
  }
}

watch(
  () => props.html,
  async () => {
    await nextTick()
    decorate()
    if (host.value) emit('rendered', host.value)
  },
  { immediate: true }
)

onBeforeUnmount(removeInstalledListeners)
</script>

<template>
  <div ref="host" class="article-content" v-html="props.html ?? ''" />
</template>

<style scoped>
/*
 * One stylesheet for every element the server's allowlist admits. It is written
 * with `:deep` because the markup arrives through `v-html` and so never carries
 * this component's scope attribute.
 */
.article-content {
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 17px;
  line-height: 28px;
}

.article-content :deep(h1),
.article-content :deep(h2),
.article-content :deep(h3),
.article-content :deep(h4),
.article-content :deep(h5),
.article-content :deep(h6) {
  margin: 32px 0 12px;
  color: var(--ink);
  font-family: var(--font-display);
  font-weight: 650;
  letter-spacing: -0.015em;
  scroll-margin-top: 24px;
}

.article-content :deep(h1) { font-size: 30px; line-height: 36px; }
.article-content :deep(h2) { font-size: 24px; line-height: 30px; }
.article-content :deep(h3) { font-size: 20px; line-height: 26px; }
.article-content :deep(h4),
.article-content :deep(h5),
.article-content :deep(h6) { font-size: 17px; line-height: 24px; }

.article-content :deep(p) { margin: 0 0 20px; }

.article-content :deep(ul),
.article-content :deep(ol) { margin: 0 0 20px; padding-left: 24px; }

.article-content :deep(li) { margin: 0 0 8px; }

.article-content :deep(blockquote) {
  margin: 24px 0;
  padding: 2px 0 2px 16px;
  border-left: 2px solid var(--line-strong);
  color: var(--ink-2);
}

.article-content :deep(pre) {
  margin: 24px 0;
  padding: 16px;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--sunken);
}

.article-content :deep(pre code) { padding: 0; border: 0; background: transparent; font-size: 13px; }

.article-content :deep(code) {
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xs);
  background: var(--sunken);
  font-family: var(--font-mono);
  font-size: 14px;
}

.article-content :deep(dl) { margin: 0 0 20px; }
.article-content :deep(dt) { font-family: var(--font-display); font-weight: 600; }
.article-content :deep(dd) { margin: 0 0 8px 20px; }

.article-content :deep(em),
.article-content :deep(i) { font-style: italic; }
.article-content :deep(strong),
.article-content :deep(b) { font-weight: 650; }
.article-content :deep(u) { text-decoration: underline; text-underline-offset: 2px; }
.article-content :deep(s) { text-decoration: line-through; color: var(--muted); }
.article-content :deep(small) { font-size: 14px; }
.article-content :deep(sub),
.article-content :deep(sup) { font-size: 11px; line-height: 0; }
.article-content :deep(mark) { padding: 0 2px; background: var(--norte-soft); color: var(--norte); }

.article-content :deep(kbd),
.article-content :deep(samp),
.article-content :deep(var) { font-family: var(--font-mono); font-size: 14px; }
.article-content :deep(var) { font-style: italic; }
.article-content :deep(kbd) {
  padding: 1px 5px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-xs);
  background: var(--sunken);
}

.article-content :deep(a) { color: var(--norte); text-decoration: underline; text-underline-offset: 2px; }
.article-content :deep(a:focus-visible) { outline: 2px solid transparent; box-shadow: var(--focus-ring); }

.article-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 24px auto;
  border-radius: var(--radius-sm);
}

.article-content :deep(figure) { margin: 24px 0; }
.article-content :deep(figure img) { margin: 0 auto; }

.article-content :deep(figcaption) {
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

.article-content :deep(table) {
  display: block;
  margin: 24px 0;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 15px;
}

.article-content :deep(th),
.article-content :deep(td) { padding: 8px 12px; border: 1px solid var(--line); text-align: left; }
.article-content :deep(th) { background: var(--sunken); font-family: var(--font-display); font-weight: 600; }

.article-content :deep(caption) {
  padding-bottom: 8px;
  color: var(--muted);
  font-size: 13px;
  text-align: left;
}

.article-content :deep(hr) { margin: 32px 0; border: 0; border-top: 1px solid var(--line); }

.article-content :deep(.article-image-failed) {
  display: block;
  margin: 24px 0;
  padding: 12px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: 14px;
  line-height: 22px;
}
</style>
