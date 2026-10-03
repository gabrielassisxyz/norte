# MaterialRow

Um material dentro do módulo, na ordem de consumo: nó de status, título (link para o leitor), autor, descrição, tipo e link para o original.

- Forneça `n`, `title`, `by`, `type` (Livro, Paper, Post, Curso, Palestra…), `optional`, `status` (`done`, `current`, `next`, `skipped`), `description`, `href` (leitor interno) e `url` (original).
- Concluído: nó cheio em `norte` com ✓. Atual: anel e "Lendo agora". Pulado: nó tracejado, título `muted` e "Pulado". Opcional aparece no tipo ("Livro · opcional").
