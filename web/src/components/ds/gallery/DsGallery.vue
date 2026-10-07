<script setup lang="ts">
import { ref } from 'vue'

import AnnotationItem from '@/components/ds/AnnotationItem.vue'
import Button from '@/components/ds/Button.vue'
import Carousel from '@/components/ds/Carousel.vue'
import CourseRow from '@/components/ds/CourseRow.vue'
import Cover from '@/components/ds/Cover.vue'
import CoverCard from '@/components/ds/CoverCard.vue'
import ExerciseItem from '@/components/ds/ExerciseItem.vue'
import Flashcard from '@/components/ds/Flashcard.vue'
import Highlight from '@/components/ds/Highlight.vue'
import Icon from '@/components/ds/Icon.vue'
import MarginNote from '@/components/ds/MarginNote.vue'
import Mark from '@/components/ds/Mark.vue'
import MaterialRow from '@/components/ds/MaterialRow.vue'
import ModuleItem from '@/components/ds/ModuleItem.vue'
import NavItem from '@/components/ds/NavItem.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import ProgressBar from '@/components/ds/ProgressBar.vue'
import QuestionItem from '@/components/ds/QuestionItem.vue'
import SectionHeader from '@/components/ds/SectionHeader.vue'
import SelectionToolbar from '@/components/ds/SelectionToolbar.vue'
import SegmentedControl from '@/components/ds/SegmentedControl.vue'
import SidePanel from '@/components/ds/SidePanel.vue'
import Stat from '@/components/ds/Stat.vue'
import StreakGrid from '@/components/ds/StreakGrid.vue'
import SyncStatus from '@/components/ds/SyncStatus.vue'
import Tabs from '@/components/ds/Tabs.vue'
import Tag from '@/components/ds/Tag.vue'
import TextField from '@/components/ds/TextField.vue'
import TrailPath from '@/components/ds/TrailPath.vue'
import type { IconName, TabItem } from '@/components/ds/types'
import { getTheme, setTheme, type Theme } from '@/theme'

const currentTheme = ref<Theme>(getTheme())

function toggleTheme(): void {
  currentTheme.value = currentTheme.value === 'dark' ? 'light' : 'dark'
  setTheme(currentTheme.value)
}

const themes = [
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Escuro' }
] as const

const modes = [
  { value: 'reading', label: 'Leitura' },
  { value: 'practice', label: 'Prática', count: '2/5' }
]
const views = [
  { value: 'covers', label: 'Capas' },
  { value: 'table', label: 'Tabela' }
]
const tabs = [
  { value: 'note', label: 'Nota' },
  { value: 'annotations', label: 'Anotações', count: 4 }
]
const panelTabs: TabItem[] = [
  { value: 'note', label: 'Nota', icon: 'note' },
  { value: 'annotations', label: 'Anotações', count: 4, icon: 'comment' }
]
const iconNames: IconName[] = [
  'check',
  'play',
  'plus',
  'lock',
  'arrow',
  'arrowLeft',
  'chevronDown',
  'collapse',
  'expand',
  'external',
  'note',
  'comment',
  'image'
]
const streakDays = Array.from({ length: 26 * 7 }, (_, index) => {
  const value = (index * 17 + 3) % 11
  return value < 2 ? 0 : Math.min(4, Math.floor(value / 2))
})

const selectedMode = ref('reading')
const selectedTab = ref('annotations')
const collapsedPanel = ref(true)
const note = ref('')

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
  <main class="ds-gallery">
    <header class="ds-gallery-header">
      <p class="ds-eyebrow">Norte · design system</p>
      <h1>Galeria de componentes</h1>
      <p>Variantes documentadas dos controles compartilhados, nos dois temas.</p>
      <button type="button" class="ds-gallery-theme" @click="toggleTheme">
        Tema: {{ currentTheme === 'dark' ? 'Escuro' : 'Claro' }}
      </button>
    </header>

    <section
      v-for="theme in themes"
      :key="theme.id"
      class="ds-theme"
      :data-theme="theme.id"
      :aria-labelledby="'ds-theme-' + theme.id"
    >
      <div class="ds-theme-heading">
        <h2 :id="'ds-theme-' + theme.id">{{ theme.label }}</h2>
        <span class="ds-theme-code">data-theme="{{ theme.id }}"</span>
      </div>

      <div class="ds-grid">
        <article class="ds-card ds-card-wide">
          <h3>Button</h3>
          <div class="ds-row">
            <Button variant="primary" icon="play">Iniciar estudo</Button>
            <Button>Adicionar nota</Button>
            <Button variant="ghost" icon="plus">Nova tarefa</Button>
            <Button disabled>Arquivar</Button>
          </div>
          <div class="ds-row">
            <Button variant="primary" size="sm">Marcar como feito</Button>
            <Button size="sm">Pular</Button>
            <Button variant="ghost" size="sm">Desfazer</Button>
          </div>
        </article>

        <article class="ds-card">
          <h3>Tag</h3>
          <div class="ds-row">
            <Tag kind="topic">Sistemas</Tag>
            <Tag kind="topic">Pesquisa</Tag>
            <Tag kind="topic" active>Projetos</Tag>
          </div>
          <div class="ds-row">
            <Tag @click="selectedTab = 'note'">leitura</Tag>
            <Tag active :count="8" @click="selectedTab = 'annotations'">conceitos</Tag>
            <Tag :count="3" @click="selectedTab = 'note'">experimentos</Tag>
            <Tag>revisão</Tag>
          </div>
        </article>

        <article class="ds-card ds-card-wide">
          <h3>SyncStatus</h3>
          <div class="ds-row ds-status-row">
            <SyncStatus state="saved" />
            <SyncStatus state="syncing" />
            <SyncStatus state="offline" />
            <SyncStatus state="conflict" />
          </div>
        </article>

        <article class="ds-card ds-card-wide">
          <h3>Stat</h3>
          <div class="ds-row ds-stats">
            <Stat :value="18" unit="dias" label="Sequência atual" />
            <Stat value="7,5" unit="h" label="Estudadas na semana" delta="+1,5 h" />
            <Stat :value="64" label="Cartões em dia" delta="−4 atrasados" delta-tone="down" />
          </div>
        </article>

        <article class="ds-card">
          <h3>ProgressBar</h3>
          <div class="ds-stack">
            <ProgressBar label="Trilha de redes" :value="0.68" />
            <ProgressBar label="Plano semanal" :value="9" :max="12" value-text="9/12 sessões" />
          </div>
        </article>

        <article class="ds-card ds-card-wide">
          <h3>StreakGrid</h3>
          <StreakGrid :days="streakDays" caption="Últimas 26 semanas · 118 dias de estudo" />
        </article>

        <article class="ds-card ds-card-wide">
          <h3>PageTitle</h3>
          <PageTitle
            title="Estudar sistemas distribuídos"
            objective="Conseguir explicar como serviços coordenam estado e recuperam falhas em produção."
          >
            <template #meta>
              <Tag kind="topic">Arquitetura</Tag>
              <Tag>backend</Tag>
              <SyncStatus state="saved" />
            </template>
            <template #actions>
              <Button>Editar plano</Button>
              <Button variant="primary" icon="play">Continuar</Button>
            </template>
          </PageTitle>
        </article>

        <article class="ds-card">
          <h3>NavItem</h3>
          <nav class="ds-nav-preview" aria-label="Navegação da galeria">
            <NavItem label="Início" active />
            <NavItem label="Currículos" :count="9" />
            <NavItem label="Assuntos" :count="5" />
            <NavItem label="Revisão" :count="16" />
            <NavItem label="Notas" :count="84" />
          </nav>
        </article>

        <article class="ds-card">
          <h3>SectionHeader</h3>
          <SectionHeader title="Próximos estudos" action-label="Ver todos" />
          <SectionHeader title="Filtros" action-label="Ver todos">
            <template #trailing>
              <SegmentedControl label="Visualização" :options="views" default-value="covers" />
            </template>
          </SectionHeader>
        </article>

        <article class="ds-card">
          <h3>SegmentedControl</h3>
          <div class="ds-stack ds-controls-stack">
            <SegmentedControl v-model="selectedMode" label="Modo" :options="modes" />
            <SegmentedControl label="Visualização" :options="views" default-value="table" />
          </div>
        </article>

        <article class="ds-card">
          <h3>Tabs</h3>
          <Tabs v-model="selectedTab" label="Painel" :items="tabs" />
        </article>

        <article class="ds-card ds-card-wide">
          <h3>SidePanel</h3>
          <div class="ds-panels">
            <SidePanel
              label="Nota e anotações"
              :tabs="panelTabs"
              :panels="{ note: 'Uma anotação sobre o material.', annotations: 'Um trecho salvo para revisar depois.' }"
              default-value="annotations"
            />
            <SidePanel v-model:collapsed="collapsedPanel" label="Nota e anotações" :tabs="panelTabs" />
          </div>
        </article>

        <article class="ds-card">
          <h3>TextField</h3>
          <div class="ds-stack">
            <TextField
              v-model="note"
              label="Nova anotação"
              multiline
              placeholder="Uma ideia sobre o material…"
            />
            <TextField
              label="Minha previsão"
              inline
              mono
              default-value="70%"
              :width="88"
              hint="Revisar na sexta"
            />
          </div>
        </article>

        <article class="ds-card ds-card-wide">
          <h3>Icon</h3>
          <div class="ds-icon-grid">
            <span v-for="name in iconNames" :key="name" class="ds-icon-item">
              <Icon :name="name" :size="18" />
              <code>{{ name }}</code>
            </span>
          </div>
        </article>
      </div>
    </section>

    <section class="gallery-legacy" aria-labelledby="gallery-legacy-title">
      <div class="gallery-legacy-head">
        <h2 id="gallery-legacy-title">Componentes de leitura e estudo</h2>
        <p>Blocos compostos usados pelas telas de currículo, leitura e revisão.</p>
      </div>

      <section class="gallery-section">
        <h3 class="gallery-name">Cover</h3>
        <Cover />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">TrailPath</h3>
        <TrailPath :steps="trailSteps" />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">CourseRow</h3>
        <CourseRow v-for="course in courses" :key="course.title" v-bind="course" />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">ModuleItem + MaterialRow</h3>
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
        <h3 class="gallery-name">ExerciseItem</h3>
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
        <h3 class="gallery-name">CoverCard</h3>
        <div class="gallery-grid">
          <CoverCard v-for="item in collections.slice(0, 3)" :key="item.title" v-bind="item" />
        </div>
      </section>

      <section class="gallery-section gallery-section-wide">
        <h3 class="gallery-name">Carousel</h3>
        <Carousel label="Currículos" :item-width="248" :visible="4" :step="2">
          <CoverCard v-for="item in collections" :key="item.title" v-bind="item" />
        </Carousel>
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">Flashcard</h3>
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
        <h3 class="gallery-name">QuestionItem</h3>
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
        <h3 class="gallery-name">Highlight</h3>
        <Highlight
          quote="Um sistema que não mede o próprio atraso descobre a fila pelo suporte."
          source="Operação sob carga, cap. 4"
          timestamp="12:47"
          note="Vale para revisão também: sem contagem de atrasados, o baralho vira dívida."
        />
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">Mark + MarginNote</h3>
        <p class="gallery-prose">
          O ponto da leitura ativa não é terminar o texto, mas
          <Mark :note="1">sair dele com uma pergunta que antes não existia</Mark>, mesmo quando o
          <Mark>assunto já parecia resolvido</Mark>.
        </p>
        <MarginNote :n="1">A pergunta vale mais que o resumo: ela sobrevive ao esquecimento do texto.</MarginNote>
      </section>

      <section class="gallery-section gallery-section-start">
        <h3 class="gallery-name">SelectionToolbar</h3>
        <SelectionToolbar @action="lastAction = $event" />
        <p class="gallery-hint">Última ação: {{ lastAction ?? '—' }}</p>
      </section>

      <section class="gallery-section">
        <h3 class="gallery-name">AnnotationItem</h3>
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
    </section>
  </main>
</template>

<style scoped>
.ds-gallery {
  min-height: 100vh;
  padding: var(--space-11);
  background: var(--ground);
  color: var(--ink);
}

.ds-gallery-header {
  position: relative;
  max-width: 760px;
  margin: 0 auto var(--space-11);
}

.ds-eyebrow,
.ds-theme-code {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 16px;
}

.ds-eyebrow {
  margin: 0 0 var(--space-2);
}

.ds-gallery-header h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 44px;
}

.ds-gallery-header > p:not(.ds-eyebrow) {
  margin: var(--space-3) 0 0;
  color: var(--ink-2);
  font-size: 18px;
  line-height: 30px;
}

.ds-gallery-theme {
  position: absolute;
  top: 0;
  right: 0;
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

.ds-gallery-theme:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

.ds-theme {
  max-width: 1120px;
  margin: 0 auto var(--space-11);
  padding: var(--space-6);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--ground);
}

.ds-theme-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.ds-theme-heading h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 30px;
}

.ds-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-6);
}

.ds-card {
  min-width: 0;
  padding: var(--space-6);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.ds-card-wide {
  grid-column: 1 / -1;
}

.ds-card h3 {
  margin: 0 0 var(--space-4);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 24px;
}

.ds-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.ds-row + .ds-row {
  margin-top: var(--space-4);
}

.ds-status-row {
  gap: var(--space-6);
}

.ds-stats {
  align-items: start;
  gap: var(--space-11);
}

.ds-stack {
  display: grid;
  gap: var(--space-4);
}

.ds-controls-stack {
  justify-items: start;
}

.ds-nav-preview {
  display: grid;
  gap: 2px;
  padding: var(--space-2);
  background: var(--sunken);
}

.ds-panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px;
  min-height: 260px;
  gap: var(--space-6);
}

.ds-panels > :first-child {
  min-width: 0;
}

.ds-icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: var(--space-4);
}

.ds-icon-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-2);
}

.ds-icon-item code {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.gallery-legacy {
  max-width: 960px;
  margin: 0 auto;
  display: grid;
  gap: var(--space-16);
}

.gallery-legacy-head {
  display: grid;
  gap: var(--space-2);
}

.gallery-legacy-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 30px;
}

.gallery-legacy-head p {
  margin: 0;
  color: var(--ink-2);
  font-size: 18px;
  line-height: 30px;
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
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: var(--space-6);
}

.gallery-hint {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
}

.gallery-prose {
  max-width: 65ch;
  margin: 0;
  color: var(--ink);
  font-size: 18px;
  line-height: 30px;
}

@media (max-width: 900px) {
  .ds-gallery {
    padding: var(--space-6);
  }

  .ds-gallery-header {
    padding-top: var(--space-9);
  }

  .ds-gallery-theme {
    top: 0;
  }

  .ds-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .ds-card-wide {
    grid-column: auto;
  }
}
</style>
