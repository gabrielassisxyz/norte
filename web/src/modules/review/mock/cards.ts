import { createStandInLibraryItem } from '@/mock/standins'
import type { LibraryItem, ReviewCard, ReviewDeck } from '@/mock/types'

export const reviewDecks: ReviewDeck[] = [
  { id: 'deck-compiladores', title: 'Construção de linguagens', curriculumSlug: 'fundamentos-de-compiladores', description: 'Conceitos de análise e execução.' },
  { id: 'deck-tipografia', title: 'Letras e leitura', curriculumSlug: 'tipografia-pratica', description: 'Ritmo, escala e leitura.' },
  { id: 'deck-aprendizagem', title: 'Aprendizagem', curriculumSlug: 'aprendizagem-autodirigida', description: 'Prática, memória e revisão.' }
]

/** Every seeded card is due the day the app is opened, so the deck is never empty. */
export function buildReviewCards(today: string): ReviewCard[] {
  const card = (id: string, deckId: string, sourceLibraryItemId: string, front: string, back: string): ReviewCard => ({ id, deckId, sourceLibraryItemId, front, back, dueAt: today })

  return [
    card('card-comp-1', 'deck-compiladores', 'post-compilation', 'Para que serve uma tabela de símbolos?', 'Ela associa nomes às informações conhecidas pelo compilador.'),
    card('card-comp-2', 'deck-compiladores', 'post-compilation', 'O que é um token?', 'Uma unidade classificada de texto de entrada.'),
    card('card-comp-3', 'deck-compiladores', 'book-interpreters', 'Quando ocorre a análise sintática?', 'Depois da leitura dos tokens e antes da avaliação.'),
    card('card-comp-4', 'deck-compiladores', 'book-interpreters', 'O que uma árvore sintática representa?', 'A estrutura de uma expressão ou programa.'),
    card('card-comp-5', 'deck-compiladores', 'paper-parsing', 'Por que recuperar após erro?', 'Para que uma ferramenta continue encontrando outros problemas.'),
    card('card-comp-6', 'deck-compiladores', 'course-git', 'O que torna um histórico útil?', 'Cada mudança explica uma intenção verificável.'),
    card('card-comp-7', 'deck-compiladores', 'post-compilation', 'O que é escopo?', 'A região onde um nome pode ser consultado.'),
    card('card-comp-8', 'deck-compiladores', 'book-interpreters', 'Qual a função de um interpretador?', 'Executar uma representação do programa.'),
    card('card-type-1', 'deck-tipografia', 'post-typography', 'O que cria hierarquia visual?', 'Diferenças deliberadas de escala, peso e espaço.'),
    card('card-type-2', 'deck-tipografia', 'post-typography', 'O que é entrelinha?', 'A distância vertical entre linhas de texto.'),
    card('card-type-3', 'deck-tipografia', 'book-type', 'Quando aumentar o espaçamento?', 'Quando o tamanho ou o peso reduzem a clareza.'),
    card('card-type-4', 'deck-tipografia', 'book-type', 'O que é uma escala tipográfica?', 'Um conjunto limitado de tamanhos relacionados.'),
    card('card-type-5', 'deck-tipografia', 'post-typography', 'Por que limitar famílias tipográficas?', 'Para manter contraste previsível e consistência.'),
    card('card-type-6', 'deck-tipografia', 'book-type', 'O que melhora a leitura em blocos longos?', 'Linhas de largura moderada e ritmo regular.'),
    card('card-type-7', 'deck-tipografia', 'post-typography', 'Qual o papel do espaço em branco?', 'Separar grupos e tornar a estrutura visível.'),
    card('card-type-8', 'deck-tipografia', 'book-type', 'O que é contraste tipográfico?', 'Uma diferença perceptível que organiza informação.'),
    card('card-learn-1', 'deck-aprendizagem', 'paper-reading', 'O que é recuperação ativa?', 'Tentar lembrar antes de consultar a resposta.'),
    card('card-learn-2', 'deck-aprendizagem', 'paper-reading', 'Por que espaçar revisões?', 'Porque o esforço de lembrar fortalece a memória.'),
    card('card-learn-3', 'deck-aprendizagem', 'podcast-habits', 'O que faz um hábito caber no dia?', 'Um gatilho claro e um passo inicial pequeno.'),
    card('card-learn-4', 'deck-aprendizagem', 'course-writing', 'O que torna uma instrução testável?', 'Ela descreve uma ação e um resultado observável.'),
    card('card-learn-5', 'deck-aprendizagem', 'paper-reading', 'Qual a diferença entre familiaridade e domínio?', 'Domínio permite usar uma ideia sem apoio imediato.'),
    card('card-learn-6', 'deck-aprendizagem', 'podcast-habits', 'O que registrar após estudar?', 'O próximo passo e a dúvida que permaneceu.'),
    card('card-learn-7', 'deck-aprendizagem', 'course-writing', 'Por que revisar perguntas?', 'Porque elas revelam lacunas de compreensão.'),
    card('card-learn-8', 'deck-aprendizagem', 'paper-reading', 'Quando uma revisão é cedo demais?', 'Quando a resposta ainda surge sem esforço algum.')
  ]
}

/** Stand-ins for the library items the cards cite as their source. */
export function buildReviewReferencedItems(today: string): LibraryItem[] {
  return [...new Set(buildReviewCards(today).map((card) => card.sourceLibraryItemId))].map((id) =>
    createStandInLibraryItem(id, today)
  )
}
