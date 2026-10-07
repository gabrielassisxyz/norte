<script setup lang="ts">
import { computed } from 'vue'

import { store } from '@/mock/store'

const studies = computed(() =>
  store.curricula
    .filter((curriculum) => curriculum.status === 'active')
    .map((curriculum, index) => {
      const materialCount = curriculum.modules.flatMap((module) => module.materials).length
      const completed = curriculum.modules.flatMap((module) => module.exercises).filter((exercise) => exercise.completed).length
      const progress = curriculum.progress ?? Math.min(1, (completed + index + 1) / Math.max(1, materialCount + curriculum.modules.length))
      const totalItems = curriculum.totalItems ?? Math.max(1, materialCount)
      const currentItem = Math.min(totalItems, curriculum.currentItem ?? Math.max(1, index + 1))
      return {
        ...curriculum,
        module: curriculum.currentModule ?? `Módulo ${Math.min(curriculum.modules.length, index + 1)}`,
        lesson: curriculum.currentLesson ?? curriculum.modules[0]?.title ?? 'Primeira lição',
        item: `item ${currentItem}/${totalItems}`,
        percent: Math.round(progress * 100),
        progress
      }
    })
)
</script>

<template>
  <section aria-labelledby="continue-study" class="home-section home-study">
    <div class="home-section-head">
      <h2 id="continue-study">Continuar estudando</h2>
      <RouterLink :to="{ name: 'estudo' }" class="home-see-all">Todos os currículos</RouterLink>
    </div>
    <div class="home-list">
      <RouterLink v-for="study in studies" :key="study.slug" :to="`/curriculos/${study.slug}`" class="home-study-row">
        <span class="home-study-main">
          <span class="home-study-title">{{ study.title }}</span>
          <span class="home-study-sub">
            <span>{{ study.module }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ study.lesson }}</span>
            <span aria-hidden="true">·</span>
            <span class="home-mono">{{ study.item }}</span>
          </span>
        </span>
        <span
          class="home-study-progress"
          role="progressbar"
          :aria-label="`Progresso de ${study.title}`"
          :aria-valuenow="study.percent"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span class="home-study-track"><span class="home-study-fill" :style="{ width: `${study.percent}%` }" /></span>
          <span class="home-mono home-study-percent">{{ study.percent }}%</span>
        </span>
        <span class="home-study-continue">Continuar</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.home-study { margin-top: 56px; }
.home-study-row { display: grid; grid-template-columns: minmax(0, 1fr) 200px 120px; gap: var(--space-6); align-items: center; padding: 14px 12px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; transition: background-color 120ms cubic-bezier(.2, 0, 0, 1); }
.home-study-row:hover { background: var(--surface); }
.home-study-row:hover .home-study-title { color: var(--norte); }
.home-study-row:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus-ring); }
.home-study-main { min-width: 0; display: grid; }
.home-study-title { overflow: hidden; color: var(--ink); font-family: var(--font-display); font-size: 17px; font-weight: 600; line-height: 24px; letter-spacing: -0.005em; text-overflow: ellipsis; white-space: nowrap; transition: color 120ms cubic-bezier(.2, 0, 0, 1); }
.home-study-sub { display: flex; gap: 10px; align-items: center; overflow: hidden; color: var(--muted); font-size: 14px; line-height: 22px; white-space: nowrap; }
.home-study-sub > span:first-child, .home-study-sub > span:nth-child(3) { overflow: hidden; text-overflow: ellipsis; }
.home-study-sub > span:not(:first-child) { flex: none; }
.home-study-progress { display: grid; gap: 6px; min-width: 0; }
.home-study-track { height: 6px; overflow: hidden; border-radius: var(--radius-full); background: var(--sunken); box-shadow: inset 0 0 0 1px var(--line); }
.home-study-fill { display: block; height: 100%; border-radius: inherit; background: var(--norte); }
.home-study-percent { color: var(--muted); font-size: 12px; line-height: 16px; }
.home-study-continue { justify-self: end; display: inline-flex; align-items: center; height: 30px; padding: 0 var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-family: var(--font-display); font-size: 13px; font-weight: 550; }
@media (max-width: 1180px) { .home-study-row { grid-template-columns: minmax(0, 1fr) 120px; } .home-study-progress { display: none; } }
@media (max-width: 560px) { .home-study-row { grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); } }
</style>
