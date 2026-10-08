/**
 * The article every suite seeds, as an HTML snapshot a save carries.
 *
 * It is long enough for the extractor to find a body in it, and it holds one
 * sentence nothing else repeats — which is what a highlight anchors by, so a
 * repeated one would be stored without a position and prove something weaker.
 */
export const PASSAGE = 'Uma frase que aparece uma única vez neste texto.'

export function articleHtml(options: { imageSrc?: string; title?: string; fillerParagraphs?: number } = {}): string {
  const title = options.title ?? 'Ler no telefone'
  const filler = Array.from(
    { length: options.fillerParagraphs ?? 0 },
    (_, index) =>
      `<p>Parágrafo de enchimento ${index + 1}, só para dar altura à página: o texto segue por mais algumas linhas para que a leitura precise rolar até o fim.</p>`
  ).join('\n      ')
  const image = options.imageSrc
    ? `<figure><img src="${options.imageSrc}" alt="Um ponto" width="8" height="8" /><figcaption>Uma figura servida de fora.</figcaption></figure>`
    : ''
  return `<!doctype html>
<html lang="pt-BR">
  <head><title>${title}</title></head>
  <body>
    <article>
      <h1>${title}</h1>
      <p>Primeiro parágrafo do texto, com frases suficientes para que a extração
      encontre um corpo de artigo e não apenas um fragmento de navegação.</p>
      <p style="line-height: 1.6">${PASSAGE} Depois dela o texto continua, para
      que exista contexto dos dois lados do trecho destacado.</p>
      ${image}
      <h2 id="uma-secao">Uma seção</h2>
      <p>Mais um parágrafo, porque um artigo de um parágrafo não é um artigo e a
      extração trata textos curtos de outro jeito.</p>
      <p>E um último parágrafo, para que a página tenha altura e a leitura role.</p>
      ${filler}
    </article>
  </body>
</html>`
}
