import type { Area, Decision, Project, Session, Task } from '@/mock/types'

export const areas: Area[] = [
  { id: 'a-casa', title: 'Casa', intention: 'Manter o espaço funcional e acolhedor.', archived: false },
  { id: 'a-aprendizagem', title: 'Aprendizagem', intention: 'Transformar curiosidade em prática.', archived: false },
  { id: 'a-tecnologia', title: 'Tecnologia', intention: 'Cuidar de ferramentas locais.', archived: false },
  { id: 'a-saude', title: 'Bem-estar', intention: 'Sustentar energia para a semana.', archived: false },
  { id: 'a-financas', title: 'Recursos', intention: 'Tomar decisões simples com clareza.', archived: false },
  { id: 'a-criacao', title: 'Criação', intention: 'Reservar espaço para fazer coisas.', archived: true }
]

export const projects: Project[] = [
  { id: 'project-servidor-caseiro', areaId: 'a-tecnologia', title: 'Servidor caseiro', purpose: 'Hospedar serviços úteis na rede local.', status: 'active', priority: 'P1', features: [{ id: 'feature-backup', title: 'Configurar cópias de segurança', complete: false }], bugs: [{ id: 'bug-dns', title: 'Resolver falha de DNS local', resolved: false }] },
  { id: 'project-horta', areaId: 'a-casa', title: 'Horta da varanda', purpose: 'Cultivar folhas e ervas para uso semanal.', status: 'active', priority: 'P2', features: [{ id: 'feature-irrigation', title: 'Montar irrigação simples', complete: false }], bugs: [] },
  { id: 'project-estudo-compiladores', areaId: 'a-aprendizagem', title: 'Interpretador de expressões', purpose: 'Aplicar os fundamentos de compiladores.', status: 'active', priority: 'P1', features: [{ id: 'feature-parser', title: 'Ler expressões com precedência', complete: true }], bugs: [{ id: 'bug-errors', title: 'Mostrar erro sem interromper a sessão', resolved: false }] },
  { id: 'project-orcamento', areaId: 'a-financas', title: 'Orçamento do mês', purpose: 'Acompanhar despesas recorrentes.', status: 'planning', priority: 'P2', features: [{ id: 'feature-categories', title: 'Definir categorias essenciais', complete: false }], bugs: [] },
  { id: 'project-caminhadas', areaId: 'a-saude', title: 'Rota de caminhadas', purpose: 'Criar um percurso curto para dias úteis.', status: 'planning', priority: 'P3', features: [], bugs: [] },
  { id: 'project-atelier', areaId: 'a-criacao', title: 'Mesa de desenho', purpose: 'Organizar um canto para estudos de observação.', status: 'paused', priority: 'P3', features: [{ id: 'feature-light', title: 'Escolher uma luminária', complete: false }], bugs: [] },
  { id: 'project-despensa', areaId: 'a-casa', title: 'Inventário da despensa', purpose: 'Evitar compras duplicadas.', status: 'completed', priority: 'P3', features: [{ id: 'feature-list', title: 'Criar lista de reposição', complete: true }], bugs: [] },
  { id: 'project-notas-estudo', areaId: 'a-aprendizagem', title: 'Caderno de estudo', purpose: 'Guardar perguntas e revisões em um só lugar.', status: 'active', priority: 'P2', features: [{ id: 'feature-questions', title: 'Separar perguntas por assunto', complete: false }], bugs: [] }
]

export const tasks: Task[] = [
  { id: 'task-backup', projectId: 'project-servidor-caseiro', title: 'Definir destinos de cópia', description: 'Escolher onde cada cópia ficará guardada.', priority: 'P1', bucket: 'today', completed: false, steps: [{ id: 'step-backup-1', title: 'Listar dados importantes', completed: true }, { id: 'step-backup-2', title: 'Escolher segundo destino', completed: false }] },
  { id: 'task-dns', projectId: 'project-servidor-caseiro', title: 'Testar nomes locais', description: 'Verificar resolução em dois dispositivos.', priority: 'P1', bucket: 'next', completed: false, steps: [{ id: 'step-dns-1', title: 'Anotar nomes esperados', completed: false }] },
  { id: 'task-sementes', projectId: 'project-horta', title: 'Separar sementes de folhas', description: 'Escolher variedades adequadas ao espaço.', priority: 'P2', bucket: 'today', completed: false, steps: [{ id: 'step-seeds-1', title: 'Medir a varanda', completed: false }] },
  { id: 'task-vasos', projectId: 'project-horta', title: 'Reutilizar vasos disponíveis', description: 'Limpar os vasos antes do plantio.', priority: 'P3', bucket: 'later', completed: false, steps: [{ id: 'step-pots-1', title: 'Lavar os vasos', completed: false }] },
  { id: 'task-parser', projectId: 'project-estudo-compiladores', title: 'Escrever casos de precedência', description: 'Cobrir soma, produto e parênteses.', priority: 'P1', bucket: 'today', completed: false, steps: [{ id: 'step-parser-1', title: 'Listar expressões', completed: true }, { id: 'step-parser-2', title: 'Adicionar expectativas', completed: false }] },
  { id: 'task-errors', projectId: 'project-estudo-compiladores', title: 'Descrever erros de entrada', description: 'Manter o retorno útil para quem estuda.', priority: 'P2', bucket: 'next', completed: false, steps: [{ id: 'step-errors-1', title: 'Criar uma mensagem para token inválido', completed: false }] },
  { id: 'task-categories', projectId: 'project-orcamento', title: 'Agrupar despesas recentes', description: 'Usar categorias que ajudem a decidir.', priority: 'P2', bucket: 'next', completed: false, steps: [{ id: 'step-categories-1', title: 'Ler extrato da semana', completed: false }] },
  { id: 'task-route', projectId: 'project-caminhadas', title: 'Medir uma rota de vinte minutos', description: 'Encontrar uma volta com calçadas tranquilas.', priority: 'P3', bucket: 'later', completed: false, steps: [{ id: 'step-route-1', title: 'Marcar pontos de retorno', completed: false }] },
  { id: 'task-light', projectId: 'project-atelier', title: 'Medir a área da mesa', description: 'Confirmar espaço antes de escolher a luz.', priority: 'P3', bucket: 'someday', completed: false, steps: [{ id: 'step-light-1', title: 'Medir largura', completed: false }] },
  { id: 'task-list', projectId: 'project-despensa', title: 'Revisar lista de reposição', description: 'Remover itens que não são mais usados.', priority: 'P3', bucket: 'later', completed: true, steps: [{ id: 'step-list-1', title: 'Comparar com a despensa', completed: true }] },
  { id: 'task-question-tags', projectId: 'project-notas-estudo', title: 'Definir temas de perguntas', description: 'Criar uma lista curta de temas recorrentes.', priority: 'P2', bucket: 'today', completed: false, steps: [{ id: 'step-tags-1', title: 'Ler perguntas abertas', completed: false }] },
  { id: 'task-review-format', projectId: 'project-notas-estudo', title: 'Testar formato de revisão', description: 'Experimentar uma sequência curta de cartões.', priority: 'P2', bucket: 'next', completed: false, steps: [{ id: 'step-format-1', title: 'Separar cinco cartões', completed: false }] }
]

export const decisions: Decision[] = [
  { id: 'decision-backup-media', projectId: 'project-servidor-caseiro', title: 'Escolher mídia para a cópia externa', context: 'A cópia deve poder sair da casa de tempos em tempos.', status: 'open', options: [{ id: 'option-drive', title: 'Disco portátil', rationale: 'Fácil de transportar e revisar.' }, { id: 'option-cloud', title: 'Armazenamento remoto', rationale: 'Disponível sem deslocamento.' }], blockedTaskIds: ['task-backup'] },
  { id: 'decision-garden-layout', projectId: 'project-horta', title: 'Definir o arranjo dos vasos', context: 'A luz muda ao longo da varanda.', status: 'postponed', options: [{ id: 'option-row', title: 'Uma fileira', rationale: 'Facilita a rega.' }, { id: 'option-groups', title: 'Grupos por necessidade', rationale: 'Aproxima plantas semelhantes.' }], blockedTaskIds: ['task-sementes'], postponedUntil: '2026-10-12' },
  { id: 'decision-parser-shape', projectId: 'project-estudo-compiladores', title: 'Escolher a forma da árvore sintática', context: 'Os exercícios precisam de uma estrutura explícita.', status: 'decided', options: [{ id: 'option-objects', title: 'Objetos discriminados', rationale: 'Mantém cada nó simples.' }, { id: 'option-classes', title: 'Classes por nó', rationale: 'Encapsula comportamento futuro.' }], selectedOptionId: 'option-objects', blockedTaskIds: ['task-parser', 'task-errors'] },
  { id: 'decision-budget-period', projectId: 'project-orcamento', title: 'Escolher o período de acompanhamento', context: 'O registro deve ser leve o suficiente para continuar.', status: 'open', options: [{ id: 'option-month', title: 'Mês calendário', rationale: 'Combina com contas recorrentes.' }, { id: 'option-payday', title: 'Entre pagamentos', rationale: 'Acompanha a entrada de dinheiro.' }], blockedTaskIds: ['task-categories'] }
]

export const sessions: Session[] = [
  { id: 'session-1', projectId: 'project-estudo-compiladores', taskId: 'task-parser', startedAt: '2026-10-01T19:00:00Z', durationMinutes: 45, summary: 'Listei expressões que precisam de parênteses.' },
  { id: 'session-2', projectId: 'project-horta', taskId: 'task-sementes', startedAt: '2026-10-01T16:00:00Z', durationMinutes: 20, summary: 'Medi a área disponível.' }
]
