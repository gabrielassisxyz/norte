# TrailPath

Uma trilha como sequência vertical de passos (cursos, módulos ou marcos), cada um com status.

- Forneça `steps`: `{ title, meta?, status }` com `status` em `done`, `current`, `next` ou `locked`.
- Concluído: nó cheio em `norte` com ✓; atual: anel `norte` e a palavra "Agora"; bloqueado: nó tracejado e a palavra. Um único `current` por trilha.
- O fio entre passos fica `norte` só no trecho concluído. Sem cartões por passo.
