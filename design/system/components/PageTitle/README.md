# PageTitle

Abre toda página de trilha, curso, plano ou assunto: o título em `display` e, logo abaixo, a frase de objetivo.

- Forneça `title` (curto, sem ponto final) e `objective`, escrito como capacidade: "Conseguir escrever um parser recursivo descendente."
- `meta` recebe tags, `ProgressBar` ou `SyncStatus`; `actions` recebe no máximo um `Button` primary e um secondary.
- Um por página. Deixe `space-16` acima e `space-9` abaixo; não coloque nada acima do título (sem eyebrow, sem chip, sem ícone em tile). Breadcrumb, se houver, vai na barra superior do app, não colado no título.
- Abaixo de 640px o título cai para o tamanho de `title`.
