# AnnotationItem

Item da lista de anotações do painel. Três formas: ligada a um trecho (trecho + nota + número da margem), só destaque (trecho + "Só destaque" + "+ Anotar este trecho") e solta (selo "Sem trecho"; ou "virou pergunta").

- Forneça `quote` e/ou `note`, `n` quando há nota de margem, `location` (seção, capítulo, página) e `time`.
- O `kind` é inferido; passe `question` para uma anotação que virou pergunta da lista de curiosidade.
