<script setup lang="ts">
import { ref } from 'vue'

import AnnotationItem from '@/components/ds/AnnotationItem.vue'
import Carousel from '@/components/ds/Carousel.vue'
import CourseRow from '@/components/ds/CourseRow.vue'
import Cover from '@/components/ds/Cover.vue'
import CoverCard from '@/components/ds/CoverCard.vue'
import ExerciseItem from '@/components/ds/ExerciseItem.vue'
import Flashcard from '@/components/ds/Flashcard.vue'
import Highlight from '@/components/ds/Highlight.vue'
import MarginNote from '@/components/ds/MarginNote.vue'
import Mark from '@/components/ds/Mark.vue'
import MaterialRow from '@/components/ds/MaterialRow.vue'
import ModuleItem from '@/components/ds/ModuleItem.vue'
import QuestionItem from '@/components/ds/QuestionItem.vue'
import SelectionToolbar from '@/components/ds/SelectionToolbar.vue'
import TrailPath from '@/components/ds/TrailPath.vue'
import { getTheme, setTheme, type Theme } from '@/theme'

const theme = ref<Theme>(getTheme())

function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  setTheme(theme.value)
}

const trailSteps = [
  { title: 'Fundamentos', meta: '4 materiais · 2 semanas', status: 'done' as const },
  { title: 'Modelos de memória', meta: '6 materiais · 3 semanas', status: 'current' as const },
  { title: 'Prática deliberada', meta: '5 materiais · 2 semanas', status: 'next' as const },
  { title: 'Projeto final', meta: 'Entrega escrita', status: 'locked' as const }
]

const courses = [
  { title: 'Teoria de filas', topic: 'Sistemas', source: 'Livro', progress: 0.5, lessons: '6/12', lastStudied: 'há 2d' },
  { title: 'Escrita técnica', topic: 'Comunicação', source: 'Curso', progress: 0.25, lessons: '3/12', lastStudied: 'há 9d' },
  { title: 'Álgebra linear', topic: 'Matemática', source: 'YouTube', progress: 1, lessons: '18/18', lastStudied: 'há 1h' }
]

const collections = [
  { title: 'Sistemas distribuídos', description: 'Entender consenso o bastante para escolher um banco com critério.' },
  { title: 'Escrita longa', description: 'Terminar um ensaio por mês, do rascunho ao publicado.' },
  { title: 'Estatística aplicada', description: 'Ler um paper empírico sem aceitar o resumo de boa fé.' },
  { title: 'Teoria musical', description: 'Tocar de ouvido uma peça nova por semana.' },
  { title: 'Geometria', description: 'Recuperar a intuição visual perdida no colégio.' },
  { title: 'Fotografia', description: 'Revelar um filme por mês e saber por que ficou assim.' }
]

const lastRating = ref<string | null>(null)
const lastAction = ref<string | null>(null)
</script>

<template>
  <main class="gallery">
    <header class="gallery-head">
      <h1 class="gallery-title">Design system</h1>
      <button type="button" class="gallery-theme" @click="toggleTheme">
        Tema: {{ theme === 'dark' ? 'Escuro' : 'Claro' }}
      </button>
    </header>

    <section class="gallery-section">
      <h2 class="gallery-name">Cover</h2>
      <Cover />
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">TrailPath</h2>
      <TrailPath :steps="trailSteps" />
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">CourseRow</h2>
      <CourseRow v-for="course in courses" :key="course.title" v-bind="course" />
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">ModuleItem + MaterialRow</h2>
      <ModuleItem
        label="02"
        title="Modelos de memória"
        meta="3 semanas · 3 materiais, 2 obrigatórios"
        status="current"
        status-text="Em andamento · 1/3"
        :default-open="true"
      >
        <MaterialRow
          :n="1"
          title="Como a repetição espaçada funciona"
          by="A. Ferraz"
          type="Post"
          status="done"
          description="A curva de esquecimento e o que ela implica para um cronograma de revisão."
          url="https://example.org/"
        />
        <MaterialRow
          :n="2"
          title="Memória de trabalho na prática"
          by="R. Nogueira"
          type="Livro"
          status="current"
          description="Capítulos 3 e 4, com os exercícios do fim de cada um."
        />
        <MaterialRow :n="3" title="Entrevista sobre consolidação" type="Palestra" :optional="true" status="skipped" />
      </ModuleItem>
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">ExerciseItem</h2>
      <ExerciseItem :n="1" kind="Explicar sem consultar" prompt="Por que intervalos crescentes batem revisão diária?">
        <p class="gallery-hint">A área de trabalho entra aqui como children.</p>
      </ExerciseItem>
      <ExerciseItem
        :n="2"
        kind="Aplicar"
        prompt="Monte um cronograma de revisão para 40 cartões novos."
        :done="true"
        answer="Quatro blocos de dez, revisados em 1, 3, 7 e 21 dias."
        time="12:40"
      />
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">CoverCard</h2>
      <div class="gallery-grid">
        <CoverCard v-for="item in collections.slice(0, 3)" :key="item.title" v-bind="item" />
      </div>
    </section>

    <section class="gallery-section gallery-section-wide">
      <h2 class="gallery-name">Carousel</h2>
      <Carousel label="Currículos" :item-width="248" :visible="4" :step="2">
        <CoverCard v-for="item in collections" :key="item.title" v-bind="item" />
      </Carousel>
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">Flashcard</h2>
      <Flashcard
        deck="Sistemas distribuídos"
        position="12/40"
        front="O que o teorema CAP obriga a escolher durante uma partição?"
        back="Entre responder com dado possivelmente velho e recusar a resposta — consistência ou disponibilidade."
        @rate="lastRating = $event"
      />
      <p class="gallery-hint">Última nota: {{ lastRating ?? '—' }}</p>
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">QuestionItem</h2>
      <QuestionItem kind="why" question="Por que relógios lógicos bastam para ordenar eventos?" topic="Sistemas" age="há 3d" />
      <QuestionItem
        kind="how"
        question="Como medir se a revisão está calibrada?"
        status="answered"
        answer="Pela taxa de acerto na primeira tentativa: perto de 90% quer dizer intervalos curtos demais."
        topic="Estudo"
        age="há 11d"
      />
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">Highlight</h2>
      <Highlight
        quote="Um sistema que não mede o próprio atraso descobre a fila pelo suporte."
        source="Operação sob carga, cap. 4"
        timestamp="12:47"
        note="Vale para revisão também: sem contagem de atrasados, o baralho vira dívida."
      />
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">Mark + MarginNote</h2>
      <p class="gallery-prose">
        O ponto da leitura ativa não é terminar o texto, mas
        <Mark :note="1">sair dele com uma pergunta que antes não existia</Mark>, mesmo quando o
        <Mark>assunto já parecia resolvido</Mark>.
      </p>
      <MarginNote :n="1">A pergunta vale mais que o resumo: ela sobrevive ao esquecimento do texto.</MarginNote>
    </section>

    <section class="gallery-section gallery-section-start">
      <h2 class="gallery-name">SelectionToolbar</h2>
      <SelectionToolbar @action="lastAction = $event" />
      <p class="gallery-hint">Última ação: {{ lastAction ?? '—' }}</p>
    </section>

    <section class="gallery-section">
      <h2 class="gallery-name">AnnotationItem</h2>
      <AnnotationItem
        quote="sair dele com uma pergunta que antes não existia"
        note="Virar isso em cartão: o que a leitura abriu, não o que ela fechou."
        :n="1"
        location="Cap. 2 · p. 48"
        time="09:12"
      />
      <AnnotationItem quote="o assunto já parecia resolvido" location="Cap. 2 · p. 49" time="09:14" />
      <AnnotationItem note="Rever a ordem dos módulos: prática deliberada antes do projeto." time="18:03" />
      <AnnotationItem kind="question" note="Dá para medir calibração sem histórico longo?" time="18:05" />
    </section>
  </main>
</template>

<style scoped>
.gallery {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-11) var(--space-6) var(--space-24);
  display: grid;
  gap: var(--space-16);
}
.gallery-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}
.gallery-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 40px;
  line-height: 44px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.gallery-theme {
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  cursor: pointer;
}
.gallery-theme:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}
.gallery-section {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}
/* The toolbar sizes itself to its buttons, so the row must not stretch it. */
.gallery-section-start {
  justify-items: start;
}
/* The carousel hangs its arrows 20px outside the track, so this row needs the slack. */
.gallery-section-wide {
  padding: 0 var(--space-6);
}
.gallery-name {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--muted);
}
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: var(--space-6);
}
.gallery-hint {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--muted);
}
.gallery-prose {
  margin: 0;
  max-width: 65ch;
  font-size: 18px;
  line-height: 30px;
  color: var(--ink);
}
</style>
