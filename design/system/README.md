Norte é uma plataforma de cursos pessoal: um lugar só para trilhas, cursos, assuntos, planos, revisões espaçadas, notas e perguntas que valem a pena perseguir. Tudo começa por um **objetivo** — cada trilha, curso e plano abre com o que se quer conseguir fazer ao final. A interface é silenciosa e precisa; o título carrega a página.

## Princípios

1. **Objetivo primeiro.** Toda página de trilha, curso ou plano abre com `PageTitle`: título em `display`, logo abaixo a frase de objetivo em `body-lg` / `ink-2` ("Quero conseguir…"). Progresso, tags e ações vêm depois.
2. **O título é o herói.** Não existe hero, banner nem ilustração. O título em `display` (64px, Schibsted 750) com `space-16` acima e `space-9` abaixo é o momento focal. Um por página.
3. **Um acento, usado com parcimônia.** `norte` (cobalto) marca o que é atual, acionável ou concluído. Se tudo é azul, nada é. `lime` existe só como marca-texto.
4. **Local first, sem cerimônia.** O estado de sincronização aparece pequeno (`SyncStatus`), nunca como modal. O app funciona offline; isso não precisa ser anunciado.
5. **Densidade honesta.** Listas são listas: linhas separadas por `line`, sem cartões. Números alinham em colunas, em mono tabular. A exceção são coleções com capa (currículos, assuntos), que usam `CoverCard`.
6. **Pouca informação por vez.** Na home e nos cards, só o que ajuda a escolher (capa, título, objetivo). Progresso, contagens e "próximo" moram na página da coleção.
7. **Aprender de memória.** Exercícios ficam numa aba própria que esconde o texto e as anotações. Nada de responder com o original ao lado.

## Conteúdo e voz

- Português do Brasil, segunda pessoa implícita, frases curtas. "Revisar 12 cartões", não "Vamos revisar seus cartões!".
- Sentence case em tudo: títulos, botões, abas. Nunca CAIXA ALTA forçada em rótulos.
- Botões começam com verbo: "Começar revisão", "Adicionar nota", "Marcar como feito".
- Objetivos são escritos como capacidade: "Conseguir escrever um parser recursivo", não "Aprender parsers".
- Perguntas da lista de curiosidade seguem 5W1H — O quê, Por quê, Quem, Quando, Onde, Como — e terminam com "?".
- Sem emoji na interface, sem exclamações, sem superlativos.
- Números: "3/12", "68%", "12:47", "42 dias" — sempre em `data` ou `metric`.

## Tipografia

- **Títulos e UI:** Schibsted Grotesk (variável, `--font-display`). `display` para o título da página, `title` para páginas secundárias, `heading` para seções, `subheading` para títulos de linha e de cartão, `label`/`label-sm` para todo controle.
- **Texto:** Geist (variável, `--font-sans`). `body` para texto corrido, sempre em coluna de no máximo `65ch`, com entrelinha 26px. `body-lg` para a linha de objetivo e leitura longa.
- **Mono:** Commit Mono (`--font-mono`; Iosevka e Cascadia Code como fallback local). Só para números, métricas, timestamps, porcentagens e código. Sempre com `font-variant-numeric: tabular-nums`.
- Nunca serifa em título. Nunca itálico decorativo. Nunca Space Grotesk.
- Pesos: títulos entre 650 e 750 com tracking negativo; UI em 550; texto em 400.

## Cor

- Fundo da página é `ground` (branco frio). Painéis e linhas selecionáveis em `surface`; sidebar, trilhos e poços em `sunken`. Nunca creme, bege ou off-white quente.
- Texto: `ink` para títulos e texto principal, `ink-2` para descrições, `muted` para metadados. Todos passam 4.5:1 sobre `ground`, `surface` e `sunken` nos dois temas. Nunca texto cinza sobre fundo colorido.
- `norte` é o único acento: botão primário, item atual da trilha, links (`link`), barra de progresso, anel de foco (`focus`). Texto sobre preenchimento norte usa `on-norte`, nunca branco literal (no escuro o norte clareia e o texto fica escuro).
- `norte-soft` é o fundo de seleção; o texto sobre ele é `norte`.
- `lime` é só marca-texto: fundo de highlights (`Mark`, `AnnotationItem`, `Highlight`, a amostra do `SelectionToolbar`), com texto `on-lime`. Nunca como texto, borda ou botão.
- `success` (verde-azulado) e `danger` (vermelho) só para estado, sempre acompanhados de palavra ou ícone. Não existe cor de aviso quente: atraso é `danger`, pendente é `muted`.
- Streak: `streak-0` a `streak-4`, uma rampa do próprio cobalto. Não use a paleta multicolorida padrão em gráficos; uma série é `norte`, a comparação é `muted`.
- Proibido: laranja, terracota, gradientes (inclusive roxo→azul), texto em gradiente, brilhos, glassmorphism, blur decorativo.

## Espaço e layout

- Base de 4px, ritmo desigual de propósito. Dentro de componentes: `space-1` a `space-4`. Entre seções: `space-9`. Acima do título da página: `space-16`. Gutter lateral: `space-11`.
- Coluna de leitura: `max-width: 65ch`. Layouts de lista podem ir até 960px; nunca texto corrido além de 65ch.
- Estrutura padrão de página: sidebar estreita em `sunken` → coluna principal em `ground` com `PageTitle`, depois seções separadas por `heading`, não por cartões.
- Nada de cartões aninhados. Um painel (`surface` + borda `line` + `radius-md`) contém linhas; linhas não viram cartões.
- Seções de página abrem com `SectionHeader`: título + "Ver todos" no lugar de contadores. Controles de visualização (`SegmentedControl`) ficam à direita do mesmo cabeçalho.

## Capas e imagens

- Currículos e assuntos têm foto de capa, proporção ~3:2, cantos `radius-md`, borda `line`. A capa é a única caixa do `CoverCard`; título e descrição ficam soltos embaixo.
- Fotos reais, escolhidas pelo usuário. Sem ilustração genérica, sem gradiente como capa. Sem foto: o espaço "Foto de capa" em `sunken`.
- Nenhuma outra imagem decorativa na interface.

## Padrões de tela

**Home (dashboard).** Sidebar (`NavItem`) → barra superior com busca, "Adicionar" e uma ação primária ("Revisar 24 cartões") → `PageTitle` com a data e o foco da semana → faixa de streak (`StreakGrid` + 4 `Stat`) entre duas linhas `line` → Currículos em `Carousel` de `CoverCard` (4 visíveis + a ponta do quinto, anda 2 por clique) → Assuntos em grade de 3 `CoverCard`, com `SegmentedControl` "Capas / Tabela"; a tabela mostra contagens por tipo em mono.

**Currículo.** Caminho "Currículos / Nome" e ações no topo → `PageTitle` com objetivo, uma linha de resumo em mono (duração, carga, materiais) e `ProgressBar` dos obrigatórios; capa à direita → a regra central do currículo em 26px + a carga semanal em `Stat` → "Percurso": uma régua de módulos clicável → `ModuleItem` por módulo, só o atual aberto, com `MaterialRow`s, instrumento, exercícios e avaliação.

**Leitor de material.** Barra superior: voltar para o módulo, posição ("item 2/7"), `SegmentedControl` "Leitura / Exercícios" no centro, ação de concluir à direita.
- *Leitura:* texto em coluna de 600–640px com `Mark` e, a 40px, uma margem de 200px com `MarginNote`s alinhadas ao parágrafo. À direita, `SidePanel` com Nota e Anotações, recolhível para um trilho de 48px. Selecionar texto abre o `SelectionToolbar`.
- *Exercícios:* texto, margem e painel somem; uma coluna de 680px com título "Exercícios", uma linha lembrando de responder de memória e os `ExerciseItem`s.
- O que muda por tipo é só o leitor: **post** é um artigo (site, tempo de leitura, título em `title`); **livro** tem barra com sumário, busca, tipografia e marcador, texto paginado com recuo de parágrafo, rodapé com `ProgressBar` e "p. 87 de 304"; **paper** mostra a página em `surface` sobre `sunken`, título, autores, resumo e duas colunas a 13.5px, com seções, páginas, zoom, "Copiar citação" e "PDF original".
- A Nota é um documento livre sobre o material inteiro; Anotações listam três formas de `AnnotationItem`: ligada a um trecho (com número de margem), só destaque, e solta ("Sem trecho", ou "virou pergunta" quando foi para a lista de curiosidade).

## Bordas, sombras, raios

- Separação vem de superfície (`ground` vs `sunken`) e de divisores `line` de 1px. Bordas de controles usam `line-strong` (3:1).
- `shadow-pop` só no que flutua (menus, popovers, command palette, `SelectionToolbar`, as setas do `Carousel`). Nunca a combinação borda fina + sombra larga e difusa em cartões em repouso.
- Raios pequenos: `radius-sm` (5px) em controles e tags, `radius-md` (8px) no máximo para painéis. `radius-full` só para trilhos de progresso e pontos de status.
- Sem barra lateral colorida em cartões, sem tile de ícone arredondado acima de títulos, sem chip "eyebrow" acima do título.

## Movimento

- Easing `cubic-bezier(0.2, 0, 0, 1)`, 120ms para hover/press, 200ms para abrir e fechar. Sem bounce, sem spring elástico.
- Nunca animar largura, altura ou posição de layout; anime `opacity` e `transform`. O flip do flashcard é um crossfade, não rotação 3D.
- Respeite `prefers-reduced-motion`: sem transição.

## Foco e acessibilidade

- Foco de teclado: `focus-ring` (2px da cor do fundo, depois 2px sólidos de `focus`), via `box-shadow` para acompanhar o raio. Sempre visível com `:focus-visible`.
- Estados nunca só por cor: concluído tem ✓ ou a palavra, atual tem rótulo, erro tem texto.
- Alvos de toque com no mínimo 32px de altura (botões têm 36px).

## Iconografia

- Traço de 1.5px, cantos e pontas arredondados, 16px na UI, 18–20px no trilho e no acordeão, herdando `currentColor`. `Norte.Icon` traz os ícones usados até aqui (check, play, plus, lock, arrow, arrowLeft, chevronDown, collapse, expand, external, note, comment, image). Para outros, use Lucide no mesmo traço.
- Ícone acompanha texto, nunca o substitui em ações principais. Sem ícone decorativo acima de títulos.
- Sem emoji.

## Componentes

`window.Norte` (React 18).

- **Estrutura:** `PageTitle` abre toda página; `NavItem` monta a sidebar; `SectionHeader` abre cada seção.
- **Ações e campos:** `Button`, `SegmentedControl` (modos de uma área), `Tabs` (conteúdos de um painel), `TextField` (texto e textarea com label), `Tag`, `SyncStatus`.
- **Progresso:** `ProgressBar`, `Stat`, `StreakGrid`.
- **Coleções:** `CoverCard` e `Carousel` para currículos e assuntos.
- **Trilhas e currículos:** `TrailPath`, `CourseRow`, `ModuleItem`, `MaterialRow`.
- **Leitor:** `Mark` e `MarginNote` no texto, `SelectionToolbar` sobre a seleção, `SidePanel` com Nota e Anotações, `AnnotationItem` na lista, `ExerciseItem` na aba de exercícios.
- **Revisão e curiosidade:** `Flashcard` (estilo Anki), `Highlight` (trecho com timestamp e nota), `QuestionItem` (5W1H).

Ainda não existem: Select, CommandPalette, Dialog, editor rico da Nota, CommunityPost. Construa-os com os mesmos tokens antes de usá-los.
