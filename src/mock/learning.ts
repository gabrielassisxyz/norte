import type { Curriculum, ReviewCard, ReviewDeck } from './types'

export const curricula: Curriculum[] = [
  { slug: 'fundamentos-de-compiladores', title: 'Fundamentos de compiladores', goal: 'Construir um interpretador pequeno e legível.', status: 'active', modules: [{ id: 'mod-lexico', title: 'Léxico e sintaxe', summary: 'Transformar texto em estruturas verificáveis.', materials: [{ id: 'mat-symbols', libraryItemId: 'post-compilation', required: true }, { id: 'mat-book-interpreters', libraryItemId: 'book-interpreters', required: true }, { id: 'mat-parsing', libraryItemId: 'paper-parsing', required: false }], exercises: [{ id: 'ex-tokenizer', title: 'Criar um tokenizador', prompt: 'Reconheça números, nomes e operadores.', completed: false }] }] },
  { slug: 'tipografia-pratica', title: 'Tipografia prática', goal: 'Escolher e aplicar tipos com intenção.', status: 'active', modules: [{ id: 'mod-rhythm', title: 'Ritmo e hierarquia', summary: 'Usar espaço e escala para guiar a leitura.', materials: [{ id: 'mat-type-post', libraryItemId: 'post-typography', required: true }, { id: 'mat-type-book', libraryItemId: 'book-type', required: false }], exercises: [{ id: 'ex-type-scale', title: 'Montar uma escala', prompt: 'Defina títulos e texto para uma página curta.', completed: true }] }] },
  { slug: 'horta-caseira', title: 'Horta caseira', goal: 'Cultivar ervas e folhas no quintal.', status: 'planned', modules: [{ id: 'mod-soil', title: 'Solo e sementes', summary: 'Preparar o canteiro antes de plantar.', materials: [{ id: 'mat-garden-post', libraryItemId: 'post-garden', required: true }, { id: 'mat-garden-book', libraryItemId: 'book-garden', required: true }, { id: 'mat-compost-paper', libraryItemId: 'paper-compost', required: false }], exercises: [{ id: 'ex-soil-log', title: 'Registrar o solo', prompt: 'Anote textura, luz e drenagem de um canteiro.', completed: false }] }] },
  { slug: 'aprendizagem-autodirigida', title: 'Aprendizagem autodirigida', goal: 'Criar ciclos curtos de estudo e revisão.', status: 'planned', modules: [{ id: 'mod-recall', title: 'Recuperação', summary: 'Praticar lembrar antes de reler.', materials: [{ id: 'mat-reading-paper', libraryItemId: 'paper-reading', required: true }, { id: 'mat-habits-podcast', libraryItemId: 'podcast-habits', required: false }, { id: 'mat-writing-course', libraryItemId: 'course-writing', required: false }], exercises: [{ id: 'ex-recall', title: 'Recontar com as próprias palavras', prompt: 'Explique uma ideia recente em cinco frases.', completed: false }] }] },
  { slug: 'casa-conectada', title: 'Casa conectada', goal: 'Organizar serviços simples na rede doméstica.', status: 'planned', modules: [{ id: 'mod-lan', title: 'Rede local', summary: 'Mapear dispositivos e serviços.', materials: [{ id: 'mat-network-video', libraryItemId: 'video-network', required: true }, { id: 'mat-server-podcast', libraryItemId: 'podcast-home-server', required: true }], exercises: [{ id: 'ex-network-map', title: 'Desenhar o mapa', prompt: 'Liste os dispositivos e a função de cada um.', completed: false }] }] },
  { slug: 'desenho-de-observacao', title: 'Desenho de observação', goal: 'Desenhar objetos cotidianos com atenção.', status: 'planned', modules: [{ id: 'mod-forms', title: 'Formas básicas', summary: 'Encontrar volumes antes de detalhes.', materials: [{ id: 'mat-sketch-video', libraryItemId: 'video-sketching', required: true }, { id: 'mat-drawing-podcast', libraryItemId: 'podcast-drawing', required: false }], exercises: [{ id: 'ex-mug', title: 'Desenhar uma caneca', prompt: 'Faça três estudos de uma caneca à luz lateral.', completed: false }] }] },
  { slug: 'financas-domesticas', title: 'Finanças domésticas', goal: 'Acompanhar despesas sem complexidade.', status: 'planned', modules: [{ id: 'mod-cashflow', title: 'Fluxo mensal', summary: 'Registrar entradas e saídas.', materials: [{ id: 'mat-budget-video', libraryItemId: 'video-budget', required: true }, { id: 'mat-finance-course', libraryItemId: 'course-finance', required: true }], exercises: [{ id: 'ex-categories', title: 'Criar categorias', prompt: 'Agrupe as últimas despesas em seis categorias.', completed: false }] }] },
  { slug: 'cozinha-do-dia-a-dia', title: 'Cozinha do dia a dia', goal: 'Cozinhar refeições simples durante a semana.', status: 'completed', modules: [{ id: 'mod-base', title: 'Bases da semana', summary: 'Preparar ingredientes versáteis.', materials: [], exercises: [{ id: 'ex-menu', title: 'Planejar quatro refeições', prompt: 'Monte um cardápio com ingredientes repetidos.', completed: true }] }] },
  { slug: 'organizacao-do-atelie', title: 'Organização do ateliê', goal: 'Manter ferramentas fáceis de encontrar.', status: 'completed', modules: [{ id: 'mod-zones', title: 'Zonas de trabalho', summary: 'Separar guardar, preparar e produzir.', materials: [], exercises: [{ id: 'ex-zones', title: 'Marcar zonas', prompt: 'Desenhe um mapa simples do espaço.', completed: true }] }] }
]

export const reviewDecks: ReviewDeck[] = [
  { id: 'deck-compiladores', title: 'Construção de linguagens', curriculumSlug: 'fundamentos-de-compiladores', description: 'Conceitos de análise e execução.' },
  { id: 'deck-tipografia', title: 'Letras e leitura', curriculumSlug: 'tipografia-pratica', description: 'Ritmo, escala e leitura.' },
  { id: 'deck-aprendizagem', title: 'Aprendizagem', curriculumSlug: 'aprendizagem-autodirigida', description: 'Prática, memória e revisão.' }
]

const card = (id: string, deckId: string, sourceLibraryItemId: string, front: string, back: string): ReviewCard => ({ id, deckId, sourceLibraryItemId, front, back, dueAt: '2026-10-03' })

export const reviewCards: ReviewCard[] = [
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
