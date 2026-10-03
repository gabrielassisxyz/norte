<script setup lang="ts">
import Button from '../../components/ds/Button.vue'
import type { LibraryItem, MaterialKind } from '../../mock/types'

const props = defineProps<{
  kind: MaterialKind
  material: LibraryItem
  answer: string
  submitted: boolean
}>()

const emit = defineEmits<{
  'update:answer': [value: string]
  submit: []
}>()

const baseDone = props.kind === 'livro' ? 0 : 1
</script>

<template>
  <section class="material-exercises" aria-labelledby="material-exercises-title">
    <div class="exercise-column">
      <div class="exercise-heading">
        <h1 id="material-exercises-title">Exercícios</h1>
        <span class="material-mono">{{ baseDone + (submitted ? 1 : 0) }}/3 feitos</span>
      </div>
      <p class="exercise-intro">
        <span class="exercise-material-title">{{ material.title }}</span> · O
        {{ kind === 'livro' ? 'livro' : kind === 'paper' ? 'paper' : 'texto' }} e as suas anotações ficam fora de vista aqui.
        Responda de memória; depois, compare com o original.
      </p>

      <div class="exercise-list">
        <article class="exercise-item" :class="{ 'is-done': baseDone > 0 }">
          <span class="exercise-number material-mono">{{ baseDone > 0 ? '✓' : '01' }}</span>
          <div>
            <div class="exercise-kind">Explicar sem consultar</div>
            <p class="exercise-prompt">
              {{ kind === 'paper' ? 'Explique a ideia central do paper em três frases.' : kind === 'livro' ? 'Qual é a diferença entre reconhecer uma ideia e conseguir recuperá-la?' : 'Descreva o caminho entre uma observação e uma hipótese testável.' }}
            </p>
            <p v-if="baseDone > 0" class="exercise-reference">
              Uma resposta curta deve nomear o que foi observado, o que foi previsto e como comparar os dois.
            </p>
            <div v-if="baseDone > 0" class="exercise-meta"><span>Feito</span><span class="material-mono">agora</span></div>
          </div>
        </article>

        <article class="exercise-item" :class="{ 'is-done': submitted }">
          <span class="exercise-number material-mono">{{ submitted ? '✓' : '02' }}</span>
          <div class="exercise-main">
            <div class="exercise-kind">Aplicar</div>
            <p class="exercise-prompt">
              Escreva uma situação da sua semana em que uma previsão poderia ter sido comparada com o resultado.
            </p>
            <label class="visually-hidden" for="material-answer">Resposta</label>
            <textarea
              id="material-answer"
              class="exercise-field"
              :value="answer"
              :disabled="submitted"
              placeholder="Responda sem consultar o material…"
              @input="emit('update:answer', ($event.target as HTMLTextAreaElement).value)"
            />
            <div v-if="submitted" class="exercise-meta"><span>Feito</span><span class="material-mono">agora</span></div>
            <div v-else class="exercise-actions">
              <a href="/notas?tab=anotacoes">Abrir anotações</a>
              <Button size="sm" variant="primary" :disabled="answer.trim().length < 10" @click="emit('submit')">Enviar resposta</Button>
            </div>
            <p v-if="!submitted && answer.trim().length > 0 && answer.trim().length < 10" class="exercise-hint">
              Escreva pelo menos 10 caracteres para enviar.
            </p>
          </div>
        </article>

        <article class="exercise-item">
          <span class="exercise-number material-mono">03</span>
          <div>
            <div class="exercise-kind">Conectar</div>
            <p class="exercise-prompt">Escolha uma nota recente e escreva qual próximo teste ela sugere.</p>
            <a class="exercise-link" href="/notas?tab=anotacoes">Abrir anotações</a>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.material-exercises {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.exercise-column {
  max-width: 680px;
  margin: 0 auto;
  padding: 56px 32px 112px;
}

.exercise-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.exercise-heading h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 40px;
  line-height: 44px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.exercise-heading > span {
  color: var(--muted);
  font-size: 13px;
}

.exercise-intro {
  max-width: 60ch;
  margin: 12px 0 0;
  color: var(--ink-2);
  font-size: 16px;
  line-height: 26px;
}

.exercise-material-title {
  color: var(--ink);
  font-family: var(--font-display);
  font-weight: 600;
}

.exercise-list {
  margin-top: 28px;
  border-top: 1px solid var(--line);
}

.exercise-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 16px;
  padding: 28px 0;
  border-bottom: 1px solid var(--line);
}

.exercise-number {
  color: var(--muted);
  font-size: 14px;
  line-height: 22px;
}

.exercise-item.is-done .exercise-number,
.exercise-meta span:first-child {
  color: var(--success);
}

.exercise-kind {
  color: var(--norte);
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
}

.exercise-prompt {
  margin: 6px 0 0;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.exercise-reference {
  margin: 10px 0 0;
  color: var(--ink-2);
  font-size: 15px;
  line-height: 24px;
}

.exercise-main {
  min-width: 0;
}

.exercise-field {
  display: block;
  width: 100%;
  min-height: 120px;
  margin-top: 14px;
  padding: 10px 12px;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--ground);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
}

.exercise-field::placeholder {
  color: var(--muted);
}

.exercise-field:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.exercise-field:disabled {
  color: var(--ink-2);
  opacity: 0.8;
}

.exercise-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.exercise-actions a,
.exercise-link {
  color: var(--link);
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 550;
  text-decoration: none;
}

.exercise-actions a:hover,
.exercise-link:hover {
  text-decoration: underline;
}

.exercise-link {
  display: inline-flex;
  margin-top: 14px;
  padding: 5px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.exercise-meta {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
  line-height: 16px;
}

.exercise-hint {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 16px;
}

.material-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 860px) {
  .material-exercises {
    overflow: visible;
  }

  .exercise-column {
    padding: 32px 16px 72px;
  }

  .exercise-heading h1 {
    font-size: 32px;
    line-height: 36px;
  }
}
</style>
