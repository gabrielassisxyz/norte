<script setup lang="ts">
import type { SyncStatusProps } from './types'

const props = withDefaults(defineProps<SyncStatusProps>(), { state: 'saved' })

const labels: Record<NonNullable<SyncStatusProps['state']>, string> = {
  saved: 'Saved locally',
  syncing: 'Syncing',
  offline: 'Offline · saved locally',
  conflict: 'Conflict to review'
}
</script>

<template>
  <span :class="['nt-sync', `nt-sync-${state}`]" role="status">
    <span class="nt-sync-dot" aria-hidden="true" />
    {{ label || labels[props.state] }}
  </span>
</template>

<style scoped>
.nt-sync {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--muted);
  font-size: 12px;
  font-weight: 450;
  line-height: 16px;
}

.nt-sync-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--success);
}

.nt-sync-syncing .nt-sync-dot {
  background: var(--norte);
}

.nt-sync-offline .nt-sync-dot {
  background: var(--muted);
}

.nt-sync-conflict {
  color: var(--danger);
}

.nt-sync-conflict .nt-sync-dot {
  background: var(--danger);
}
</style>
