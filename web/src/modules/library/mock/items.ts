import { daysAgo, timestampDaysAgo } from '@/mock/relative'
import type { LibraryItem } from '@/mock/types'

/**
 * The library's own slice, dated against the clock the app is running on: each
 * entry says how many days ago it was saved, so the shelf still reads as a
 * shelf someone uses rather than one abandoned on a fixed date.
 *
 * An item that has been read keeps the list it sits in and carries `read_at`;
 * nothing here is "read" as a status, because reading is an event.
 */
export function buildLibraryItems(today: string): LibraryItem[] {
  const saved = (days: number): string => daysAgo(today, days)
  /** Read two days after it was saved, which is what makes `read_at` plausible. */
  const read = (savedDaysAgo: number): Pick<LibraryItem, 'unread' | 'read_at'> => ({
    unread: false,
    read_at: timestampDaysAgo(today, Math.max(0, savedDaysAgo - 2))
  })

  return [
    { id: 'post-compilation', kind: 'post', title: 'Mapas de símbolos em compiladores pequenos', author: 'Equipe Norte', url: 'https://example.com/compilation-symbols', domain: 'compiler-notes.example', minutes: 8, readProgress: 0.42, status: 'inbox', unread: true, savedAt: saved(4), curriculumSlug: 'fundamentos-de-compiladores' },
    { id: 'post-typography', kind: 'post', title: 'Ritmo tipográfico em interfaces densas', author: 'Equipe Norte', url: 'https://example.com/type-rhythm', domain: 'type-notes.example', minutes: 14, readProgress: 0.28, status: 'depois', unread: true, savedAt: saved(5), curriculumSlug: 'tipografia-pratica' },
    { id: 'post-garden', kind: 'post', title: 'Planejamento de canteiros por estação', author: 'Equipe Norte', url: 'https://example.com/garden-seasons', domain: 'garden-journal.example', minutes: 22, readProgress: 0.55, status: 'arquivo', ...read(13), savedAt: saved(13), curriculumSlug: 'horta-caseira' },
    { id: 'book-interpreters', kind: 'livro', title: 'Pequenas Linguagens, Grandes Ideias', author: 'Marina Costa', url: 'https://example.com/small-languages', domain: 'language-lab.example', minutes: 28, readProgress: 0.36, status: 'inbox', unread: true, savedAt: saved(0), curriculumSlug: 'fundamentos-de-compiladores' },
    { id: 'book-type', kind: 'livro', title: 'Letras em Movimento', author: 'Rui Nogueira', url: 'https://example.com/letters-motion', domain: 'type-foundry.example', minutes: 34, readProgress: 0.72, status: 'arquivo', ...read(21), savedAt: saved(21), curriculumSlug: 'tipografia-pratica' },
    { id: 'book-garden', kind: 'livro', title: 'Solo Vivo no Quintal', author: 'Clara Mendes', url: 'https://example.com/living-soil', domain: 'backyard-garden.example', minutes: 11, readProgress: 0.18, status: 'depois', unread: true, savedAt: saved(11), curriculumSlug: 'horta-caseira' },
    { id: 'paper-parsing', kind: 'paper', title: 'Parsing Incremental para Ferramentas Locais', author: 'I. Ramos', url: 'https://example.com/incremental-parsing', domain: 'local-tools.example', minutes: 16, readProgress: 0.63, status: 'inbox', unread: true, savedAt: saved(4), curriculumSlug: 'fundamentos-de-compiladores' },
    { id: 'paper-reading', kind: 'paper', title: 'Leitura Ativa e Recuperação de Longo Prazo', author: 'L. Ferreira', url: 'https://example.com/active-reading', domain: 'learning-notes.example', minutes: 20, readProgress: 0.48, status: 'arquivo', ...read(15), savedAt: saved(15), curriculumSlug: 'aprendizagem-autodirigida' },
    { id: 'paper-compost', kind: 'paper', title: 'Compostagem Doméstica em Pequena Escala', author: 'A. Vieira', url: 'https://example.com/home-compost', domain: 'soil-notes.example', minutes: 18, readProgress: 0.31, status: 'arquivo', ...read(23), savedAt: saved(23), curriculumSlug: 'horta-caseira' },
    { id: 'video-network', kind: 'video', title: 'Uma visita guiada a redes domésticas', author: 'Canal Oficina', url: 'https://example.com/home-network', domain: 'home-network.example', minutes: 18, status: 'inbox', unread: true, savedAt: saved(1), curriculumSlug: 'casa-conectada' },
    { id: 'video-sketching', kind: 'video', title: 'Esboços rápidos para organizar ideias', author: 'Canal Oficina', url: 'https://example.com/quick-sketches', domain: 'sketching.example', minutes: 12, status: 'depois', unread: true, savedAt: saved(7), curriculumSlug: 'desenho-de-observacao' },
    { id: 'video-budget', kind: 'video', title: 'Orçamento mensal em uma planilha simples', author: 'Canal Oficina', url: 'https://example.com/monthly-budget', domain: 'budget-notes.example', minutes: 9, status: 'arquivo', ...read(19), savedAt: saved(19), curriculumSlug: 'financas-domesticas' },
    { id: 'podcast-home-server', kind: 'podcast', title: 'Serviços pessoais que cabem em casa', author: 'Rádio Local', url: 'https://example.com/personal-services', domain: 'home-services.example', minutes: 26, status: 'inbox', unread: true, savedAt: saved(4), curriculumSlug: 'casa-conectada' },
    { id: 'podcast-drawing', kind: 'podcast', title: 'Observar antes de desenhar', author: 'Rádio Local', url: 'https://example.com/observe-draw', domain: 'observation.example', minutes: 15, status: 'arquivo', ...read(24), savedAt: saved(24), curriculumSlug: 'desenho-de-observacao' },
    { id: 'podcast-habits', kind: 'podcast', title: 'Pequenos sistemas para dias comuns', author: 'Rádio Local', url: 'https://example.com/ordinary-days', domain: 'learning-routines.example', minutes: 13, status: 'depois', unread: true, savedAt: saved(9), curriculumSlug: 'aprendizagem-autodirigida' },
    { id: 'course-git', kind: 'curso', title: 'Histórico Git sem mistério', author: 'Laboratório Aberto', url: 'https://example.com/git-history', domain: 'versioned-work.example', minutes: 21, status: 'inbox', unread: true, savedAt: saved(1), curriculumSlug: 'fundamentos-de-compiladores' },
    { id: 'course-finance', kind: 'curso', title: 'Finanças pessoais de bolso', author: 'Laboratório Aberto', url: 'https://example.com/pocket-finance', domain: 'everyday-finance.example', minutes: 17, status: 'arquivo', ...read(17), savedAt: saved(17), curriculumSlug: 'financas-domesticas' },
    { id: 'course-writing', kind: 'curso', title: 'Escrever instruções que funcionam', author: 'Laboratório Aberto', url: 'https://example.com/clear-instructions', domain: 'writing-lab.example', minutes: 10, status: 'arquivo', ...read(22), savedAt: saved(22), curriculumSlug: 'aprendizagem-autodirigida' }
  ]
}
