<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import type { MenuProps } from './types'

/**
 * A button that opens a small menu of choices under itself.
 *
 * The items are the caller's: this component owns the trigger, the panel, and
 * everything about reaching the items without a pointer -- which is the part
 * every menu has to get right and no menu gets right by accident. It finds the
 * items by their `role`, so the caller is free to group them, head them or
 * leave one of them disabled without this file knowing the shape.
 */
withDefaults(defineProps<MenuProps>(), {
  menuLabel: undefined,
  active: false,
  disabled: false,
  align: 'right'
})

const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)

/**
 * The items, in the order they are on screen, skipping any that is disabled.
 *
 * Read from the DOM rather than from a list of options, because the items come
 * in through a slot: the caller renders them, so the caller's markup is the
 * only place that knows how many there are.
 */
function items(): HTMLElement[] {
  const host = panel.value
  if (host === null) return []
  return Array.from(host.querySelectorAll<HTMLElement>('[role^="menuitem"]')).filter(
    (node) => !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true'
  )
}

/** The item the menu should land on: the chosen one, or the first. */
function focusItem(index: number): void {
  const found = items()
  if (found.length === 0) return
  const wrapped = (index + found.length) % found.length
  found[wrapped].focus()
}

function focusChosen(): void {
  const found = items()
  const chosen = found.findIndex((node) => node.getAttribute('aria-checked') === 'true')
  focusItem(chosen === -1 ? 0 : chosen)
}

function close(returnFocus = true): void {
  if (!open.value) return
  open.value = false
  // Focus goes back to the trigger, because the item that held it is about to
  // leave the document and focus would otherwise fall to the body -- which is
  // the end of keyboard navigation for whoever was using it.
  if (returnFocus) trigger.value?.focus()
}

function toggle(): void {
  open.value = !open.value
}

function openWithKeyboard(): void {
  if (!open.value) open.value = true
}

function move(step: number): void {
  const found = items()
  if (found.length === 0) return
  const active = document.activeElement as HTMLElement | null
  const current = active === null ? -1 : found.indexOf(active)
  focusItem(current === -1 ? 0 : current + step)
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    focusItem(0)
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    focusItem(items().length - 1)
  }
}

/**
 * A choice closes the menu, whatever the caller's handler did with it.
 *
 * The item's own listener has already run by the time the click reaches here,
 * so a caller that navigates on a choice is not raced by this.
 */
function onPanelClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('[role^="menuitem"]')) close()
}

/**
 * Escape and an outside click are listened for on the document.
 *
 * Both have to work while focus is anywhere -- on the trigger, on an item, or
 * on nothing at all -- and the panel's own handlers only see what happens
 * inside it. The panel keeps its `keydown` for Escape as well, so the key
 * works for a caller that stops the event before it leaves the menu.
 */
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

function onDocumentPointerDown(event: Event): void {
  const target = event.target as Node | null
  if (target === null) return
  if (panel.value?.contains(target) || trigger.value?.contains(target)) return
  // No focus handed back: the pointer has already put it somewhere else, and
  // pulling it to the trigger would undo what the person just clicked on.
  close(false)
}

function listen(active: boolean): void {
  const method = active ? 'addEventListener' : 'removeEventListener'
  document[method]('keydown', onDocumentKeydown as EventListener)
  document[method]('mousedown', onDocumentPointerDown)
}

watch(open, async (isOpen) => {
  listen(isOpen)
  if (!isOpen) return
  await nextTick()
  focusChosen()
})

onBeforeUnmount(() => listen(false))
</script>

<template>
  <div class="nt-menu">
    <button
      ref="trigger"
      type="button"
      class="nt-menu-trigger"
      :class="{ 'is-active': active, 'is-open': open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="label"
      :disabled="disabled"
      @click="toggle()"
      @keydown.down.prevent="openWithKeyboard()"
    >
      <slot name="trigger" />
    </button>
    <div
      v-if="open"
      ref="panel"
      class="nt-menu-panel"
      :class="align === 'left' ? 'nt-menu-left' : 'nt-menu-right'"
      role="menu"
      :aria-label="menuLabel ?? label"
      @keydown="onPanelKeydown"
      @click="onPanelClick"
    >
      <slot :close="close" />
    </div>
  </div>
</template>

<style scoped>
.nt-menu {
  position: relative;
  display: inline-flex;
}

.nt-menu-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 7px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
}

.nt-menu-trigger:hover:not(:disabled) {
  background: var(--sunken);
  color: var(--ink);
}

.nt-menu-trigger.is-open {
  background: var(--sunken);
  color: var(--ink);
}

.nt-menu-trigger.is-active {
  color: var(--norte);
}

.nt-menu-trigger:disabled {
  color: var(--muted);
  cursor: default;
}

.nt-menu-trigger:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.nt-menu-panel {
  position: absolute;
  top: calc(100% + 4px);
  z-index: 30;
  display: grid;
  min-width: 220px;
  padding: 4px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}

.nt-menu-right {
  right: 0;
}

.nt-menu-left {
  left: 0;
}
</style>
