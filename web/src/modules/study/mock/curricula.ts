import { createStandInLibraryItem } from '@/mock/standins'
import type { Curriculum, LibraryItem } from '@/mock/types'

export const curricula: Curriculum[] = [
  {
    slug: 'fundamentos-de-compiladores',
    title: 'Fundamentos de compiladores',
    goal: 'Construir um interpretador pequeno e legível.',
    status: 'active',
    currentModule: 'Módulo 1',
    currentLesson: 'Léxico e sintaxe',
    currentItem: 2,
    totalItems: 8,
    progress: 0.25,
    modules: [
      {
        id: 'mod-lexico',
        title: 'Léxico e sintaxe',
        summary: 'Transformar texto em estruturas verificáveis antes de tentar executar qualquer coisa.',
        weeks: 4,
        materials: [
          { id: 'mat-symbols', libraryItemId: 'post-compilation', required: true },
          { id: 'mat-book-interpreters', libraryItemId: 'book-interpreters', required: true },
          { id: 'mat-parsing', libraryItemId: 'paper-parsing', required: false }
        ],
        exercises: [
          { id: 'ex-tokenizer', title: 'Criar um tokenizador', prompt: 'Reconheça números, nomes e operadores.', completed: false },
          { id: 'ex-errors', title: 'Mensagens de erro úteis', prompt: 'Aponte a linha e a coluna de um caractere inesperado.', completed: false }
        ],
        instrument: {
          name: 'Instrumento: registro de tokens',
          rows: [
            { key: 'Entrada', value: 'O trecho de texto lido' },
            { key: 'Classe', value: 'Número, nome, operador ou pontuação' },
            { key: 'Posição', value: 'Linha e coluna de início' },
            { key: 'Decisão', value: 'Aceitar, descartar ou reportar erro' }
          ],
          note: 'Registre a posição desde o primeiro token: reconstruí-la depois custa bem mais.'
        },
        evaluation: 'Dado um arquivo com um erro de sintaxe, produza a lista de tokens até o erro e uma mensagem que aponte onde ele está.'
      },
      {
        id: 'mod-arvores',
        title: 'Árvores e precedência',
        summary: 'Dar forma à expressão antes de atribuir significado a ela.',
        weeks: 5,
        materials: [
          { id: 'mat-trees-book', libraryItemId: 'book-interpreters', required: true },
          { id: 'mat-trees-paper', libraryItemId: 'paper-parsing', required: true },
          { id: 'mat-trees-git', libraryItemId: 'course-git', required: false }
        ],
        exercises: [
          { id: 'ex-precedence', title: 'Tabela de precedência', prompt: 'Escreva a ordem dos operadores e justifique cada posição.', completed: false },
          { id: 'ex-ast', title: 'Montar a árvore', prompt: 'Converta três expressões em árvores desenhadas à mão.', completed: false }
        ],
        evaluation: 'Explique, sem consultar notas, por que a sua árvore avalia uma expressão com parênteses na ordem correta.'
      },
      {
        id: 'mod-execucao',
        title: 'Execução e escopo',
        summary: 'Percorrer a árvore mantendo nomes e valores onde eles devem estar.',
        weeks: 4,
        materials: [
          { id: 'mat-exec-post', libraryItemId: 'post-compilation', required: true },
          { id: 'mat-exec-book', libraryItemId: 'book-interpreters', required: true }
        ],
        exercises: [
          { id: 'ex-scope', title: 'Escopos aninhados', prompt: 'Resolva um nome declarado duas vezes em níveis diferentes.', completed: false }
        ],
        instrument: {
          name: 'Instrumento: tabela de símbolos',
          rows: [
            { key: 'Nome', value: 'O identificador declarado' },
            { key: 'Escopo', value: 'Onde a declaração vale' },
            { key: 'Tipo', value: 'O que o nome aceita' },
            { key: 'Origem', value: 'A posição da declaração' }
          ]
        },
        evaluation: 'Execute um programa curto com funções aninhadas e explique cada consulta de nome que o interpretador fez.'
      },
      {
        id: 'mod-projeto-compilador',
        title: 'Projeto final: a linguagem inteira',
        summary: 'Juntar léxico, árvore e execução em um programa que roda de ponta a ponta.',
        weeks: 2,
        materials: [],
        exercises: [
          { id: 'ex-final-language', title: 'Fechar o ciclo', prompt: 'Rode um programa de vinte linhas, do texto ao resultado.', completed: false }
        ],
        evaluation: 'O interpretador executa um programa escrito por outra pessoa, ou aponta onde ele está errado.'
      }
    ]
  },
  {
    slug: 'tipografia-pratica',
    title: 'Tipografia prática',
    goal: 'Escolher e aplicar tipos com intenção.',
    status: 'active',
    currentModule: 'Módulo 1',
    currentLesson: 'Ritmo e hierarquia',
    currentItem: 1,
    totalItems: 5,
    progress: 0.2,
    modules: [
      {
        id: 'mod-rhythm',
        title: 'Ritmo e hierarquia',
        summary: 'Usar espaço e escala para guiar a leitura em vez de decorar a página.',
        weeks: 3,
        materials: [
          { id: 'mat-type-post', libraryItemId: 'post-typography', required: true },
          { id: 'mat-type-book', libraryItemId: 'book-type', required: false }
        ],
        exercises: [
          { id: 'ex-type-scale', title: 'Montar uma escala', prompt: 'Defina títulos e texto para uma página curta.', completed: true }
        ],
        instrument: {
          name: 'Instrumento: a escala em uso',
          rows: [
            { key: 'Papel', value: 'Título, subtítulo, corpo ou apoio' },
            { key: 'Tamanho', value: 'O valor escolhido na escala' },
            { key: 'Entrelinha', value: 'A altura de linha correspondente' },
            { key: 'Motivo', value: 'O que a diferença deve comunicar' }
          ],
          note: 'Se um papel não muda nada na leitura, ele não precisa de um tamanho próprio.'
        },
        evaluation: 'Aplique a escala a um texto que você não escreveu e explique cada diferença de tamanho.'
      },
      {
        id: 'mod-leitura-longa',
        title: 'Leitura longa',
        summary: 'Manter o olho na linha quando o texto passa de algumas telas.',
        weeks: 3,
        materials: [
          { id: 'mat-long-book', libraryItemId: 'book-type', required: true },
          { id: 'mat-long-post', libraryItemId: 'post-typography', required: false }
        ],
        exercises: [
          { id: 'ex-measure', title: 'Encontrar a medida', prompt: 'Compare três larguras de coluna lendo o mesmo texto em voz alta.', completed: false }
        ],
        evaluation: 'Justifique a largura de coluna e a entrelinha de um texto longo sem recorrer a preferência pessoal.'
      },
      {
        id: 'mod-interface-densa',
        title: 'Interfaces densas',
        summary: 'Tipografia onde o espaço é disputado por tabelas, rótulos e números.',
        weeks: 2,
        materials: [
          { id: 'mat-dense-post', libraryItemId: 'post-typography', required: true }
        ],
        exercises: [
          { id: 'ex-numbers', title: 'Números alinhados', prompt: 'Alinhe uma coluna de valores sem aumentar a altura da linha.', completed: false }
        ],
        evaluation: 'Uma tela com tabela, rótulos e títulos legível em duas larguras de janela diferentes.'
      }
    ]
  },
  {
    slug: 'horta-caseira',
    title: 'Horta caseira',
    goal: 'Cultivar ervas e folhas no quintal.',
    status: 'planned',
    modules: [
      {
        id: 'mod-soil',
        title: 'Solo e sementes',
        summary: 'Preparar o canteiro antes de plantar qualquer coisa.',
        weeks: 3,
        materials: [
          { id: 'mat-garden-post', libraryItemId: 'post-garden', required: true },
          { id: 'mat-garden-book', libraryItemId: 'book-garden', required: true },
          { id: 'mat-compost-paper', libraryItemId: 'paper-compost', required: false }
        ],
        exercises: [
          { id: 'ex-soil-log', title: 'Registrar o solo', prompt: 'Anote textura, luz e drenagem de um canteiro.', completed: false }
        ],
        instrument: {
          name: 'Instrumento: diário do canteiro',
          rows: [
            { key: 'Data', value: 'Quando a observação foi feita' },
            { key: 'Luz', value: 'Horas de sol direto no ponto' },
            { key: 'Água', value: 'Quanto e com que frequência' },
            { key: 'Observação', value: 'O que mudou desde a última anotação' }
          ],
          note: 'Uma anotação curta por semana explica mais que uma longa por estação.'
        },
        evaluation: 'Descreva o canteiro a ponto de outra pessoa decidir o que plantar nele.'
      },
      {
        id: 'mod-rega',
        title: 'Rega e rotina',
        summary: 'Transformar o cuidado em algo que cabe numa semana comum.',
        weeks: 4,
        materials: [
          { id: 'mat-rega-book', libraryItemId: 'book-garden', required: true },
          { id: 'mat-rega-compost', libraryItemId: 'paper-compost', required: false }
        ],
        exercises: [
          { id: 'ex-rega', title: 'Medir a rega', prompt: 'Registre quanta água o canteiro recebe por semana.', completed: false }
        ],
        evaluation: 'Uma rotina de rega que sobrevive a uma semana cheia sem perder plantas.'
      },
      {
        id: 'mod-colheita',
        title: 'Colheita',
        summary: 'Cortar na hora certa para a planta continuar produzindo.',
        weeks: 2,
        materials: [
          { id: 'mat-colheita-post', libraryItemId: 'post-garden', required: true }
        ],
        exercises: [
          { id: 'ex-colheita', title: 'Primeira colheita', prompt: 'Colha um maço de folhas sem interromper o crescimento.', completed: false }
        ],
        evaluation: 'A mesma planta produz uma segunda colheita depois da primeira.'
      }
    ]
  },
  {
    slug: 'aprendizagem-autodirigida',
    title: 'Aprendizagem autodirigida',
    goal: 'Criar ciclos curtos de estudo e revisão.',
    status: 'planned',
    modules: [
      {
        id: 'mod-recall',
        title: 'Recuperação',
        summary: 'Praticar lembrar antes de reler.',
        weeks: 4,
        materials: [
          { id: 'mat-reading-paper', libraryItemId: 'paper-reading', required: true },
          { id: 'mat-habits-podcast', libraryItemId: 'podcast-habits', required: false },
          { id: 'mat-writing-course', libraryItemId: 'course-writing', required: false }
        ],
        exercises: [
          { id: 'ex-recall', title: 'Recontar com as próprias palavras', prompt: 'Explique uma ideia recente em cinco frases.', completed: false }
        ],
        instrument: {
          name: 'Instrumento: separar estudo de evidência',
          rows: [
            { key: 'Estudo', value: 'Ler, assistir, anotar, procurar' },
            { key: 'Evidência', value: 'Explicar sem consultar, resolver algo novo, lembrar depois de uma semana' }
          ],
          note: 'A sensação de ter entendido não é evidência de aprendizagem.'
        },
        evaluation: 'Explique um assunto novo no dia 1 e no dia 7, e compare as duas explicações.'
      },
      {
        id: 'mod-ciclos',
        title: 'Ciclos e intervalos',
        summary: 'Espaçar as revisões para que lembrar custe algum esforço.',
        weeks: 3,
        materials: [
          { id: 'mat-ciclos-paper', libraryItemId: 'paper-reading', required: true },
          { id: 'mat-ciclos-podcast', libraryItemId: 'podcast-habits', required: true }
        ],
        exercises: [
          { id: 'ex-calibration', title: 'Calibrar a confiança', prompt: 'Estime quanto vai lembrar em sete dias e depois teste.', completed: false }
        ],
        evaluation: 'Uma semana de revisões em que a estimativa e o resultado ficam a menos de 20% de distância.'
      }
    ]
  },
  {
    slug: 'casa-conectada',
    title: 'Casa conectada',
    goal: 'Organizar serviços simples na rede doméstica.',
    status: 'planned',
    modules: [
      {
        id: 'mod-lan',
        title: 'Rede local',
        summary: 'Mapear dispositivos e serviços antes de adicionar mais um.',
        weeks: 3,
        materials: [
          { id: 'mat-network-video', libraryItemId: 'video-network', required: true },
          { id: 'mat-server-podcast', libraryItemId: 'podcast-home-server', required: true }
        ],
        exercises: [
          { id: 'ex-network-map', title: 'Desenhar o mapa', prompt: 'Liste os dispositivos e a função de cada um.', completed: false }
        ],
        instrument: {
          name: 'Instrumento: inventário da rede',
          rows: [
            { key: 'Dispositivo', value: 'Nome e tipo' },
            { key: 'Endereço', value: 'Fixo ou atribuído' },
            { key: 'Serviço', value: 'O que ele oferece à casa' },
            { key: 'Responsável', value: 'Quem percebe primeiro quando ele cai' }
          ]
        },
        evaluation: 'O mapa permite responder, sem consultar o roteador, o que para de funcionar quando um dispositivo é desligado.'
      },
      {
        id: 'mod-servicos',
        title: 'Serviços que ficam de pé',
        summary: 'Deixar um serviço rodando sem supervisão diária.',
        weeks: 3,
        materials: [
          { id: 'mat-servicos-podcast', libraryItemId: 'podcast-home-server', required: true }
        ],
        exercises: [
          { id: 'ex-restart', title: 'Sobreviver a um reinício', prompt: 'Reinicie a máquina e verifique o que voltou sozinho.', completed: false }
        ],
        evaluation: 'Depois de um reinício, todo serviço essencial volta sem intervenção.'
      }
    ]
  },
  {
    slug: 'desenho-de-observacao',
    title: 'Desenho de observação',
    goal: 'Desenhar objetos cotidianos com atenção.',
    status: 'planned',
    modules: [
      {
        id: 'mod-forms',
        title: 'Formas básicas',
        summary: 'Encontrar volumes antes de detalhes.',
        weeks: 3,
        materials: [
          { id: 'mat-sketch-video', libraryItemId: 'video-sketching', required: true },
          { id: 'mat-drawing-podcast', libraryItemId: 'podcast-drawing', required: false }
        ],
        exercises: [
          { id: 'ex-mug', title: 'Desenhar uma caneca', prompt: 'Faça três estudos de uma caneca à luz lateral.', completed: false }
        ],
        evaluation: 'Três desenhos do mesmo objeto em que o volume se reconhece sem contorno fechado.'
      },
      {
        id: 'mod-luz',
        title: 'Luz e sombra',
        summary: 'Usar valor em vez de linha para descrever a forma.',
        weeks: 3,
        materials: [
          { id: 'mat-luz-video', libraryItemId: 'video-sketching', required: true }
        ],
        exercises: [
          { id: 'ex-luz', title: 'Escala de valores', prompt: 'Desenhe o mesmo objeto com cinco valores apenas.', completed: false }
        ],
        evaluation: 'Um desenho em que a direção da luz é óbvia para quem não viu a cena.'
      }
    ]
  },
  {
    slug: 'financas-domesticas',
    title: 'Finanças domésticas',
    goal: 'Acompanhar despesas sem complexidade.',
    status: 'planned',
    modules: [
      {
        id: 'mod-cashflow',
        title: 'Fluxo mensal',
        summary: 'Registrar entradas e saídas com o mínimo de esforço por semana.',
        weeks: 3,
        materials: [
          { id: 'mat-budget-video', libraryItemId: 'video-budget', required: true },
          { id: 'mat-finance-course', libraryItemId: 'course-finance', required: true }
        ],
        exercises: [
          { id: 'ex-categories', title: 'Criar categorias', prompt: 'Agrupe as últimas despesas em seis categorias.', completed: false }
        ],
        instrument: {
          name: 'Instrumento: o mês em uma página',
          rows: [
            { key: 'Entrada', value: 'Quanto entrou e de onde' },
            { key: 'Fixo', value: 'O que sai todo mês no mesmo valor' },
            { key: 'Variável', value: 'O que depende de escolhas da semana' },
            { key: 'Sobra', value: 'O que restou, antes de decidir o destino' }
          ]
        },
        evaluation: 'Um mês fechado em que cada despesa cabe em uma das categorias, sem recorrer a "outros".'
      },
      {
        id: 'mod-decisoes',
        title: 'Decisões de gasto',
        summary: 'Separar o gasto que compra tempo do que compra conforto.',
        weeks: 2,
        materials: [
          { id: 'mat-decisoes-course', libraryItemId: 'course-finance', required: true }
        ],
        exercises: [
          { id: 'ex-tradeoff', title: 'Dez decisões', prompt: 'Classifique dez gastos recentes pelo que cada um comprou.', completed: false }
        ],
        evaluation: 'Uma página que explica para que o dinheiro serve nesta casa, com exemplos do próprio mês.'
      }
    ]
  },
  {
    slug: 'cozinha-do-dia-a-dia',
    title: 'Cozinha do dia a dia',
    goal: 'Cozinhar refeições simples durante a semana.',
    status: 'completed',
    modules: [
      {
        id: 'mod-base',
        title: 'Bases da semana',
        summary: 'Preparar ingredientes versáteis em um único dia.',
        weeks: 2,
        materials: [],
        exercises: [
          { id: 'ex-menu', title: 'Planejar quatro refeições', prompt: 'Monte um cardápio com ingredientes repetidos.', completed: true }
        ],
        evaluation: 'Quatro refeições da semana saem das mesmas compras.'
      }
    ]
  },
  {
    slug: 'organizacao-do-atelie',
    title: 'Organização do ateliê',
    goal: 'Manter ferramentas fáceis de encontrar.',
    status: 'completed',
    modules: [
      {
        id: 'mod-zones',
        title: 'Zonas de trabalho',
        summary: 'Separar guardar, preparar e produzir.',
        weeks: 1,
        materials: [],
        exercises: [
          { id: 'ex-zones', title: 'Marcar zonas', prompt: 'Desenhe um mapa simples do espaço.', completed: true }
        ],
        evaluation: 'Qualquer ferramenta volta ao lugar sem decisão nova.'
      }
    ]
  }
]

/**
 * Stand-ins for every library item a curriculum module names, so this slice
 * stays readable on its own once the library's mock slice is deleted.
 */
export const studyReferencedItems: LibraryItem[] = [
  ...new Set(curricula.flatMap((curriculum) => curriculum.modules.flatMap((module) => module.materials.map((material) => material.libraryItemId))))
].map(createStandInLibraryItem)
