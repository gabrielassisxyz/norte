# ModuleItem

Um módulo de currículo como acordeão: número, título, duração e contagem, status à direita.

- Forneça `label` ("01", "Final"), `title`, `meta` ("5 semanas · 7 materiais, 5 obrigatórios"), `status` (`done`, `current`, `next`) e `statusText` ("Em andamento · 1/5").
- O corpo (`children`) segue a ordem: introdução em `body` / `ink-2` (máx. 65ch), `MaterialRow`s, instrumento (tabela curta), exercícios, avaliação.
- Só o módulo atual abre por padrão.
