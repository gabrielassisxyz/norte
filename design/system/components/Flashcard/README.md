# Flashcard

Revisão espaçada no estilo Anki: frente, resposta revelada, e quatro botões de avaliação com o próximo intervalo.

- Forneça `deck`, `position` ("12/40"), `front`, `back`, `intervals` (os quatro próximos intervalos) e `onRate(rating)`.
- Antes de revelar: só a frente e "Mostrar resposta" (primary) com a dica de tecla. Depois: a resposta abaixo de um divisor e os botões "De novo / Difícil / Bom / Fácil" — "Bom" é o primary, "De novo" tem rótulo em `danger`.
- Atalhos: espaço revela; 1–4 avaliam. A troca é um crossfade de 200ms, nunca flip 3D.
