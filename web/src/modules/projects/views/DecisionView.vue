<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import Icon from '@/components/ds/Icon.vue'
import PageTitle from '@/components/ds/PageTitle.vue'
import TextField from '@/components/ds/TextField.vue'
import { useAsyncAction } from '@/lib/asyncResource'
import { daysBetweenIsoDates, formatShortDate, shiftIsoDate, todayIsoDate } from '@/lib/clock'
import type { DecisionOption, MaterialKind } from '@/mock/types'
import { useLibraryItems } from '@/modules/library/data/composables'
import type { LibraryItemSummary } from '@/modules/library/data/source'
import { crossModuleActionAllowed } from '@/modules/mounting'
import { useSources } from '@/sources'

import { useDecision } from '../data/composables'

const props = withDefaults(defineProps<{ id?: string; preselect?: boolean }>(), {
  id: '',
  preselect: false
})

type Choice = string | null
interface Tradeoffs {
  software: string
  uso: string
  custo: string
  reversivel: string
}

const OTHER_CHOICE = 'other'
/** A decision with no date of its own is asked for within the week. */
const DEFAULT_DUE_DAYS = 7

const LEAN_OPTION_BY_DECISION: Record<string, string> = {
  'decision-backup-media': 'option-drive',
  'decision-garden-layout': 'option-groups',
  'decision-parser-shape': 'option-objects',
  'decision-budget-period': 'option-month'
}

const REFERENCE_IDS_BY_DECISION: Record<string, string[]> = {
  'decision-backup-media': ['post-compilation', 'paper-reading', 'book-interpreters'],
  'decision-garden-layout': ['post-garden', 'book-garden', 'paper-compost'],
  'decision-parser-shape': ['post-compilation', 'book-interpreters', 'paper-parsing'],
  'decision-budget-period': ['paper-reading', 'post-typography', 'book-type']
}

const OPTION_TRADEOFFS: Record<string, Tradeoffs> = {
  'option-drive': {
    software: 'Configuração pequena e sem serviço adicional.',
    uso: 'Permite revisar a cópia fora de casa.',
    custo: 'Comprar e manter uma mídia extra.',
    reversivel: 'Sim, a mídia pode ser trocada.'
  },
  'option-cloud': {
    software: 'Depende de um provedor e de uma rotina de envio.',
    uso: 'Acesso disponível em qualquer lugar com conexão.',
    custo: 'Mensalidade e dependência de rede.',
    reversivel: 'Sim, exportando a cópia.'
  },
  'option-row': {
    software: 'Organização simples para automatizar a rega.',
    uso: 'Deixa o acesso a cada vaso direto.',
    custo: 'Menos flexibilidade para variar a disposição.',
    reversivel: 'Sim, movendo os vasos.'
  },
  'option-groups': {
    software: 'Exige observar a luz antes de fixar os lugares.',
    uso: 'Agrupa plantas com necessidades parecidas.',
    custo: 'A disposição pode ocupar mais espaço.',
    reversivel: 'Sim, sem obra permanente.'
  },
  'option-objects': {
    software: 'Tipos explícitos e fáceis de serializar.',
    uso: 'A leitura da árvore fica uniforme nos exercícios.',
    custo: 'Comportamento fica fora dos objetos.',
    reversivel: 'Sim, com uma camada de adaptação.'
  },
  'option-classes': {
    software: 'Cada nó pode concentrar seus próprios métodos.',
    uso: 'Operações comuns ficam próximas dos dados.',
    custo: 'Mais cerimônia para persistir e testar.',
    reversivel: 'Parcial, exigindo conversão dos nós.'
  },
  'option-month': {
    software: 'Agrupa registros por um período conhecido.',
    uso: 'Facilita comparar o mês atual com o anterior.',
    custo: 'Mudanças no dia do pagamento ficam menos visíveis.',
    reversivel: 'Sim, mantendo os registros.'
  },
  'option-payday': {
    software: 'Precisa registrar o ciclo de cada entrada.',
    uso: 'Acompanha melhor o dinheiro disponível.',
    custo: 'Exige mais contexto em cada lançamento.',
    reversivel: 'Sim, reagrupando os lançamentos.'
  }
}

/** The reading behind a decision lives in the library; it is linkable only while that module is mounted. */
const canReachLibrary = computed(() => crossModuleActionAllowed('projects', 'library'))

const route = useRoute()
const { projects: projectsSource } = useSources()

const decisionId = computed(() => props.id || String(route.params.id ?? ''))
const { data: detail, loading, error, refresh, applyDecision } = useDecision(decisionId)
const writing = useAsyncAction()

const firstLoad = computed(() => loading.value && detail.value === null)
const decision = computed(() => detail.value?.decision)
const project = computed(() => detail.value?.project)
const area = computed(() => detail.value?.area)
const relatedDecisions = computed(() => detail.value?.related ?? [])
const blockedTasks = computed(() => detail.value?.blockedTasks ?? [])
const decidedCount = computed(() => detail.value?.decidedCount ?? 0)
const leanOptionId = computed(() => {
  const current = decision.value
  if (!current) return undefined
  return LEAN_OPTION_BY_DECISION[current.id] ?? current.options[0]?.id
})

const selectedChoice = ref<Choice>(null)
const reasoning = ref('')
const locallyDecided = ref(false)
const editing = ref(false)
const editTitle = ref('')
const editContext = ref('')

const selectedOption = computed(() =>
  decision.value?.options.find((option) => option.id === selectedChoice.value)
)
const isDecided = computed(() => locallyDecided.value && decision.value?.status === 'decided')
const selectedLabel = computed(() => {
  if (selectedChoice.value === OTHER_CHOICE) return 'Outra'
  return selectedOption.value?.title ?? 'Outra'
})
const canDecide = computed(
  () =>
    selectedChoice.value !== null &&
    (selectedChoice.value !== OTHER_CHOICE || reasoning.value.trim().length > 0)
)
const dueDate = computed(() => decision.value?.postponedUntil ?? shiftIsoDate(todayIsoDate(), DEFAULT_DUE_DAYS))
const dueText = computed(() => `até ${formatShortDate(dueDate.value)} · ${daysRemaining(dueDate.value)} dias`)
const statusText = computed(() => (isDecided.value ? `Decidida hoje: ${selectedLabel.value}` : 'Pendente'))
const domain = computed(() => area.value?.title ?? 'Projetos')
const blockedCountText = computed(() => `${blockedTasks.value.length} ${blockedTasks.value.length === 1 ? 'tarefa' : 'tarefas'}`)
const contextParagraphs = computed(() => {
  const current = decision.value
  if (!current) return []
  const taskNames = blockedTasks.value.map((task) => task.title).join(' e ')
  const followUp = taskNames
    ? `Registrar a escolha deixa o próximo passo visível para ${taskNames}.`
    : 'Registrar a escolha deixa o próximo passo visível para o projeto.'
  return [current.context, followUp]
})
/** The reading behind a decision is the library's, read only while that crossing is allowed. */
const { data: libraryPage } = useLibraryItems({}, canReachLibrary)

const references = computed(() => {
  const current = decision.value
  if (!current) return []
  const readable = (libraryPage.value?.items ?? []).filter(isReadableMaterial)
  const ids = REFERENCE_IDS_BY_DECISION[current.id] ?? readable.slice(0, 3).map((item) => item.id)
  return ids
    .map((id) => readable.find((item) => item.id === id))
    .filter((item): item is LibraryItemSummary & { kind: MaterialKind } => item !== undefined)
})

function isReadableMaterial(item: LibraryItemSummary): item is LibraryItemSummary & { kind: MaterialKind } {
  return item.kind === 'post' || item.kind === 'livro' || item.kind === 'paper'
}

function daysRemaining(value: string): number {
  return Math.max(0, daysBetweenIsoDates(todayIsoDate(), value) + 1)
}

function taskTarget(taskId: string): { name: 'tarefa'; params: { id: string } } {
  return { name: 'tarefa', params: { id: taskId } }
}

function decisionTarget(decisionIdValue: string): { name: 'decisao'; params: { id: string } } {
  return { name: 'decisao', params: { id: decisionIdValue } }
}

function optionTradeoffs(option: DecisionOption): Tradeoffs {
  return (
    OPTION_TRADEOFFS[option.id] ?? {
      software: option.rationale,
      uso: 'Mantém um próximo passo explícito.',
      custo: 'Avaliar depois dos primeiros usos.',
      reversivel: 'Revisável com novos dados.'
    }
  )
}

function resetState(): void {
  const current = decision.value
  if (!current) {
    selectedChoice.value = null
    reasoning.value = ''
    locallyDecided.value = false
    editing.value = false
    return
  }

  selectedChoice.value =
    current.selectedOptionId ??
    (props.preselect && current.status !== 'decided' ? leanOptionId.value ?? null : null)
  reasoning.value = current.reasoning ?? ''
  locallyDecided.value = current.status === 'decided'
  editTitle.value = current.title
  editContext.value = current.context
  editing.value = false
}

function chooseOption(optionId: string): void {
  selectedChoice.value = optionId
  locallyDecided.value = false
}

function chooseOther(): void {
  selectedChoice.value = OTHER_CHOICE
  locallyDecided.value = false
}

/**
 * The choice is recorded by the source, and the screen then shows the decision
 * it answered with. "Outra" travels as the reason behind it, which is the only
 * thing that distinguishes it from a choice of a recorded option.
 */
async function decide(): Promise<void> {
  const current = decision.value
  const choice = selectedChoice.value
  if (!current || choice === null || !canDecide.value) return

  const decided = await writing.run(() =>
    projectsSource.decideDecision(
      current.id,
      choice,
      choice === OTHER_CHOICE ? reasoning.value.trim() : undefined
    )
  )
  if (!decided) return

  applyDecision(decided)
  locallyDecided.value = true
}

async function postpone(): Promise<void> {
  const current = decision.value
  if (!current || isDecided.value) return
  const postponed = await writing.run(() =>
    projectsSource.postponeDecision(current.id, shiftIsoDate(dueDate.value, DEFAULT_DUE_DAYS))
  )
  if (!postponed) return

  applyDecision(postponed)
  selectedChoice.value = null
  locallyDecided.value = false
}

function startEditing(): void {
  const current = decision.value
  if (!current) return
  editTitle.value = current.title
  editContext.value = current.context
  editing.value = true
}

function cancelEditing(): void {
  const current = decision.value
  if (current) {
    editTitle.value = current.title
    editContext.value = current.context
  }
  editing.value = false
}

async function saveEditing(): Promise<void> {
  const current = decision.value
  const title = editTitle.value.trim()
  if (!current || !title) return
  const updated = await writing.run(() =>
    projectsSource.updateDecision(current.id, { title, context: editContext.value.trim() })
  )
  if (!updated) return

  applyDecision(updated)
  editing.value = false
}

/**
 * The screen's own state is derived from the decision the source holds, so it
 * is re-derived whenever that answer changes — on arrival, on a route change,
 * and after a write. That is what makes the choice on screen the one that came
 * back rather than the one that was sent.
 */
watch([decision, decisionId, () => props.preselect], resetState, { immediate: true })
</script>

<template>
  <main class="decision-view">
    <div v-if="firstLoad" class="decision-inner decision-missing" role="status">
      <p>Carregando a decisão…</p>
    </div>

    <div v-else-if="error" class="decision-inner decision-missing" role="alert">
      <p>Não foi possível carregar a decisão: {{ error }}</p>
      <button type="button" class="decision-back" @click="refresh()">Tentar de novo</button>
    </div>

    <div v-else-if="!decision" class="decision-inner decision-missing">
      <PageTitle title="Decisão não encontrada" objective="Nenhuma decisão responde por este endereço." />
      <RouterLink class="decision-back" to="/projetos">Ver projetos</RouterLink>
    </div>

    <div v-else class="decision-inner">
      <p v-if="writing.error.value" class="decision-write-error" role="alert">
        Não foi possível salvar: {{ writing.error.value }}
      </p>

      <div class="decision-top">
        <nav class="decision-crumbs" aria-label="Caminho">
          <RouterLink class="decision-crumb" to="/projetos">Projetos</RouterLink>
          <span class="decision-separator" aria-hidden="true">/</span>
          <RouterLink v-if="area" class="decision-crumb" :to="{ name: 'area', params: { id: area.id } }">
            {{ area.title }}
          </RouterLink>
          <span v-if="area" class="decision-separator" aria-hidden="true">/</span>
          <RouterLink v-if="project" class="decision-crumb" :to="{ name: 'projeto', params: { id: project.id } }">
            {{ project.title }}
          </RouterLink>
          <span v-if="project" class="decision-separator" aria-hidden="true">/</span>
          <span class="decision-current">Decisão</span>
        </nav>

        <div class="decision-actions">
          <button
            type="button"
            class="decision-action"
            :aria-pressed="editing"
            @click="editing ? cancelEditing() : startEditing()"
          >
            {{ editing ? 'Fechar edição' : 'Editar' }}
          </button>
          <button type="button" class="decision-action" :disabled="isDecided" @click="postpone">
            Adiar uma semana
          </button>
          <button
            type="button"
            class="decision-action decision-action-primary"
            :disabled="!canDecide"
            @click="decide"
          >
            <Icon name="check" :size="14" />
            {{ isDecided ? 'Decidida' : 'Decidir' }}
          </button>
        </div>
      </div>

      <div class="decision-page">
        <div class="decision-main">
          <div class="decision-heading">
            <PageTitle v-if="!editing" :title="decision.title" :objective="project?.purpose ?? decision.context" />
            <div v-else class="decision-editor">
              <TextField id="decision-title" label="Pergunta" :multiline="true" :rows="2" v-model="editTitle" />
              <TextField
                id="decision-context"
                label="Objetivo da decisão"
                :multiline="true"
                :rows="2"
                v-model="editContext"
              />
              <div class="decision-editor-actions">
                <button
                  type="button"
                  class="decision-action decision-action-primary"
                  :disabled="!editTitle.trim()"
                  @click="saveEditing"
                >
                  Salvar
                </button>
                <button type="button" class="decision-action" @click="cancelEditing">Cancelar</button>
              </div>
            </div>
          </div>

          <div class="decision-status-row" aria-label="Estado da decisão">
            <span class="decision-status" :class="{ 'is-decided': isDecided }">
              <span class="decision-status-dot" aria-hidden="true" />
              {{ statusText }}
            </span>
            <span class="decision-mono">{{ dueText }}</span>
            <span class="decision-mono">{{ domain }} · aberta há 23 dias</span>
            <span v-if="blockedTasks.length > 0" class="decision-block-summary">
              Bloqueia
              <RouterLink :to="taskTarget(blockedTasks[0].id)">
                {{ blockedCountText }}
              </RouterLink>
            </span>
          </div>

          <section class="decision-section decision-context" aria-labelledby="decision-context-heading">
            <h2 id="decision-context-heading" class="decision-section-title">Contexto</h2>
            <div class="decision-copy">
              <p v-for="paragraph in contextParagraphs" :key="paragraph">{{ paragraph }}</p>
            </div>
          </section>

          <section class="decision-section" aria-labelledby="decision-options-heading">
            <div class="decision-section-heading">
              <h2 id="decision-options-heading" class="decision-section-title">Opções</h2>
              <span class="decision-section-hint">Escolha uma; o campo abaixo é livre em qualquer caso</span>
            </div>

            <div class="decision-options" role="radiogroup" aria-label="Opções da decisão">
              <button
                v-for="option in decision.options"
                :key="option.id"
                type="button"
                role="radio"
                :aria-checked="selectedChoice === option.id"
                :class="['decision-option', { 'is-selected': selectedChoice === option.id }]"
                @click="chooseOption(option.id)"
              >
                <span class="decision-radio" aria-hidden="true" />
                <span class="decision-option-body">
                  <span class="decision-option-head">
                    <span class="decision-option-title">{{ option.title }}</span>
                    <span v-if="option.id === leanOptionId" class="decision-lean">tendência atual</span>
                  </span>
                  <span class="decision-option-description">{{ option.rationale }}</span>
                  <span class="decision-impacts">
                    <span class="decision-key">software</span>
                    <span>{{ optionTradeoffs(option).software }}</span>
                    <span class="decision-key">uso</span>
                    <span>{{ optionTradeoffs(option).uso }}</span>
                    <span class="decision-key">custo</span>
                    <span>{{ optionTradeoffs(option).custo }}</span>
                    <span class="decision-key">reversível</span>
                    <span>{{ optionTradeoffs(option).reversivel }}</span>
                  </span>
                </span>
              </button>

              <button
                type="button"
                role="radio"
                :aria-checked="selectedChoice === OTHER_CHOICE"
                :class="['decision-option decision-other', { 'is-selected': selectedChoice === OTHER_CHOICE }]"
                @click="chooseOther"
              >
                <span class="decision-radio" aria-hidden="true" />
                <span class="decision-other-body">
                  <span class="decision-option-title">Outra</span>
                  <span class="decision-option-description">Nenhuma das acima. Descreva no campo abaixo.</span>
                </span>
              </button>
            </div>

            <div class="decision-reasoning">
              <label for="decision-reasoning-input">{{ selectedChoice === OTHER_CHOICE ? 'Qual é a outra opção, e por quê' : 'Raciocínio (opcional)' }}</label>
              <textarea
                id="decision-reasoning-input"
                v-model="reasoning"
                rows="4"
                placeholder="Por que esta opção, o que me faria mudar de ideia, ou a opção que falta…"
              />
              <span>Vai para o registro da decisão junto com a opção escolhida e a data.</span>
            </div>
          </section>

          <section class="decision-section decision-references" aria-labelledby="decision-references-heading">
            <h2 id="decision-references-heading" class="decision-section-title">O que li para decidir</h2>
            <div class="decision-reference-list">
              <component
                :is="canReachLibrary ? RouterLink : 'div'"
                v-for="reference in references"
                :key="reference.id"
                class="decision-reference"
                :to="canReachLibrary ? { name: 'leitor', params: { id: reference.id } } : undefined"
              >
                <span class="decision-reference-kind decision-mono">{{ reference.kind }}</span>
                <span class="decision-reference-title">{{ reference.title }}</span>
                <span class="decision-reference-meta decision-mono">{{ reference.unread ? formatShortDate(reference.saved_at) : 'lido' }}</span>
              </component>
            </div>
          </section>
        </div>

        <aside class="decision-aside">
          <div class="decision-meta">
            <span class="decision-key">projeto</span>
            <RouterLink v-if="project" class="decision-meta-link" :to="{ name: 'projeto', params: { id: project.id } }">
              {{ project.title }}
            </RouterLink>
            <span v-else>—</span>
            <span class="decision-key">domínio</span>
            <span class="decision-meta-value">{{ domain }}</span>
            <span class="decision-key">prazo</span>
            <span class="decision-meta-value decision-mono">{{ formatShortDate(dueDate) }}</span>
            <span class="decision-key">aberta em</span>
            <span class="decision-meta-value decision-mono">{{ decision ? formatShortDate(decision.createdAt) : '—' }}</span>
            <span class="decision-key">tendência</span>
            <span class="decision-meta-value">{{ decision.options.find((option) => option.id === leanOptionId)?.title ?? '—' }}</span>
          </div>

          <div class="decision-aside-section">
            <span class="decision-aside-heading">Bloqueia</span>
            <RouterLink
              v-for="task in blockedTasks"
              :key="task.id"
              class="decision-blocked-task"
              :to="taskTarget(task.id)"
            >
              {{ task.title }}
            </RouterLink>
            <span v-if="blockedTasks.length === 0" class="decision-aside-empty">Nenhuma tarefa.</span>
          </div>

          <div class="decision-aside-section">
            <span class="decision-aside-heading">Outras decisões do projeto</span>
            <RouterLink
              v-for="other in relatedDecisions"
              :key="other.id"
              class="decision-related"
              :to="decisionTarget(other.id)"
            >
              {{ other.title }} <span class="decision-related-due decision-mono">{{ other.postponedUntil ? formatShortDate(other.postponedUntil) : 'sem prazo' }}</span>
            </RouterLink>
            <RouterLink
              v-if="project"
              class="decision-related decision-related-muted"
              :to="{ name: 'projeto', params: { id: project.id }, hash: '#decisoes' }"
            >
              Decididas <span class="decision-mono">{{ decidedCount }}</span>
            </RouterLink>
          </div>
        </aside>
      </div>
    </div>
  </main>
</template>

<style scoped>
.decision-inner {
  max-width: 1120px;
  margin: 0 auto;
}

.decision-write-error {
  margin: 0 0 var(--space-4);
  color: var(--danger);
  font-size: 13px;
  line-height: 20px;
}

.decision-missing {
  padding-top: var(--space-16);
}

.decision-back {
  display: inline-block;
  margin-top: var(--space-6);
  color: var(--link);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
}

.decision-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.decision-crumbs {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  line-height: 20px;
}

.decision-crumb {
  color: var(--muted);
  text-decoration: none;
}

.decision-crumb:hover {
  color: var(--ink);
}

.decision-separator {
  color: var(--line-strong);
}

.decision-current {
  color: var(--ink);
}

.decision-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.decision-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}

.decision-action:hover {
  background: var(--surface);
  color: var(--ink);
}

.decision-action:disabled {
  background: var(--sunken);
  color: var(--muted);
  cursor: not-allowed;
}

.decision-action-primary {
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  background: var(--norte);
  color: var(--on-norte);
}

.decision-action-primary:hover {
  background: var(--norte-hover);
  color: var(--on-norte);
}

.decision-action-primary:disabled {
  border-color: var(--line);
  background: var(--sunken);
  color: var(--muted);
}

.decision-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  align-items: start;
  gap: 64px;
}

.decision-main {
  min-width: 0;
}

.decision-heading {
  min-height: 180px;
  padding-top: var(--space-16);
}

.decision-editor {
  display: grid;
  max-width: 640px;
  gap: 20px;
}

.decision-editor-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.decision-status-row {
  display: flex;
  align-items: center;
  gap: 24px;
  min-height: 54px;
  padding: 16px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}

.decision-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  line-height: 20px;
}

.decision-status.is-decided {
  color: var(--success);
}

.decision-status-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: currentColor;
}

.decision-mono {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
}

.decision-block-summary {
  margin-left: auto;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 20px;
}

.decision-block-summary a {
  color: var(--link);
}

.decision-section {
  margin-top: 56px;
}

.decision-section-title {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -0.015em;
  line-height: 30px;
}

.decision-copy {
  display: grid;
  max-width: 65ch;
  gap: 16px;
  margin-top: 16px;
}

.decision-copy p {
  margin: 0;
  color: var(--ink);
  font-size: 16px;
  line-height: 26px;
  text-wrap: pretty;
}

.decision-section-heading {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.decision-section-hint {
  color: var(--muted);
  font-size: 14px;
  line-height: 20px;
}

.decision-options {
  display: grid;
  gap: 12px;
}

.decision-option {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: start;
  width: 100%;
  gap: 16px;
  padding: 20px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms cubic-bezier(0.2, 0, 0, 1);
}

.decision-option:hover {
  border-color: var(--line-strong);
}

.decision-option.is-selected {
  border-color: var(--norte);
  box-shadow: inset 0 0 0 1px var(--norte);
}

.decision-radio {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-top: 3px;
  border: 1.5px solid var(--line-strong);
  border-radius: var(--radius-full);
  background: var(--surface);
}

.decision-option.is-selected .decision-radio {
  border-color: var(--norte);
}

.decision-option.is-selected .decision-radio::after {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--norte);
  content: '';
}

.decision-option-body {
  display: grid;
  min-width: 0;
  max-width: 72ch;
  gap: 16px;
}

.decision-option-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.decision-option-title {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 24px;
}

.decision-lean {
  color: var(--norte);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.decision-option-description {
  color: var(--ink-2);
  font-size: 14px;
  line-height: 22px;
  text-wrap: pretty;
}

.decision-impacts {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 4px 16px;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 22px;
}

.decision-key {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 22px;
}

.decision-other {
  gap: 16px;
}

.decision-other-body {
  display: grid;
  gap: 6px;
}

.decision-other .decision-option-description {
  color: var(--muted);
}

.decision-reasoning {
  display: grid;
  gap: 8px;
  margin-top: 24px;
}

.decision-reasoning label {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 550;
  line-height: 20px;
}

.decision-reasoning textarea {
  width: 100%;
  min-height: 120px;
  padding: 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 24px;
  resize: vertical;
}

.decision-reasoning textarea::placeholder {
  color: var(--muted);
}

.decision-reasoning > span {
  color: var(--muted);
  font-size: 13px;
  line-height: 20px;
}

.decision-reference-list {
  border-top: 1px solid var(--line);
}

.decision-reference {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
  text-decoration: none;
}

.decision-reference:hover .decision-reference-title {
  color: var(--norte);
}

.decision-reference-title {
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 22px;
}

.decision-reference-meta {
  color: var(--muted);
}

.decision-aside {
  position: sticky;
  top: 92px;
  display: grid;
  align-content: start;
  gap: 28px;
  padding-top: var(--space-16);
}

.decision-meta {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 6px 16px;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 22px;
}

.decision-meta .decision-key {
  line-height: 22px;
}

.decision-meta-link {
  color: var(--ink);
  font-family: var(--font-display);
  font-weight: 550;
  text-decoration: none;
}

.decision-meta-link:hover {
  color: var(--norte);
}

.decision-meta-value {
  min-width: 0;
}

.decision-aside-section {
  display: grid;
  gap: 4px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}

.decision-aside-heading {
  margin-bottom: 4px;
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 550;
  line-height: 16px;
}

.decision-blocked-task,
.decision-related {
  color: var(--ink-2);
  font-size: 14px;
  line-height: 22px;
  text-decoration: none;
}

.decision-blocked-task:hover,
.decision-related:hover {
  color: var(--norte);
}

.decision-aside-empty {
  color: var(--muted);
  font-size: 14px;
  line-height: 22px;
}

.decision-related-due {
  color: var(--muted);
  font-size: 12px;
}

.decision-related-muted {
  color: var(--muted);
}

.decision-action:focus-visible,
.decision-crumb:focus-visible,
.decision-back:focus-visible,
.decision-option:focus-visible,
.decision-reference:focus-visible,
.decision-meta-link:focus-visible,
.decision-blocked-task:focus-visible,
.decision-related:focus-visible,
.decision-reasoning textarea:focus-visible {
  outline: 2px solid transparent;
  box-shadow: var(--focus-ring);
}

@media (max-width: 1240px) {
  .decision-page {
    grid-template-columns: minmax(0, 1fr);
  }

  .decision-aside {
    position: static;
    padding-top: 0;
  }
}

@media (max-width: 900px) {
  .decision-page {
    gap: var(--space-11);
  }

  .decision-heading {
    padding-top: var(--space-11);
  }
}

@media (max-width: 640px) {
  .decision-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .decision-status-row {
    gap: 12px 20px;
  }

  .decision-block-summary {
    width: 100%;
    margin-left: 0;
  }

  .decision-option {
    padding: 16px 12px;
  }

  .decision-impacts {
    grid-template-columns: minmax(72px, 88px) minmax(0, 1fr);
  }

  .decision-reference {
    grid-template-columns: 64px minmax(0, 1fr);
  }

  .decision-reference-meta {
    grid-column: 2;
  }
}
</style>
