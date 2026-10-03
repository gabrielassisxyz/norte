import type * as React from 'react';

/** Abre toda página de trilha, curso ou plano: título grande + objetivo. */
export interface PageTitleProps { title: React.ReactNode; objective?: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; className?: string }
export declare function PageTitle(props: PageTitleProps): React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'md' | 'sm'; icon?: IconName }
export declare function Button(props: ButtonProps): React.ReactElement;

export interface TagProps { kind?: 'tag' | 'topic'; active?: boolean; count?: number; onClick?: () => void; children?: React.ReactNode; className?: string }
export declare function Tag(props: TagProps): React.ReactElement;

export interface SyncStatusProps { state?: 'saved' | 'syncing' | 'offline' | 'conflict'; label?: string }
export declare function SyncStatus(props: SyncStatusProps): React.ReactElement;

export interface ProgressBarProps { value: number; max?: number; label?: string; valueText?: string; className?: string }
export declare function ProgressBar(props: ProgressBarProps): React.ReactElement;

export interface StatProps { value: React.ReactNode; unit?: string; label: string; delta?: string; deltaTone?: 'up' | 'down' }
export declare function Stat(props: StatProps): React.ReactElement;

/** days: um nível 0–4 por dia, em ordem cronológica; colunas de 7 dias (semanas). */
export interface StreakGridProps { days: number[]; label?: string; caption?: string }
export declare function StreakGrid(props: StreakGridProps): React.ReactElement;

export interface TrailStep { title: string; meta?: string; status?: 'done' | 'current' | 'next' | 'locked' }
export interface TrailPathProps { steps: TrailStep[] }
export declare function TrailPath(props: TrailPathProps): React.ReactElement;

/** progress de 0 a 1; lessons como texto ("3/12"); lastStudied como texto curto ("há 2d"). */
export interface CourseRowProps { title: string; topic?: string; source?: string; progress?: number; lessons?: string; lastStudied?: string; href?: string }
export declare function CourseRow(props: CourseRowProps): React.ReactElement;

export interface FlashcardProps { deck?: string; position?: string; front: React.ReactNode; back: React.ReactNode; revealed?: boolean; intervals?: [string, string, string, string]; onReveal?: () => void; onRate?: (rating: 'again' | 'hard' | 'good' | 'easy') => void }
export declare function Flashcard(props: FlashcardProps): React.ReactElement;

export interface HighlightProps { quote: React.ReactNode; source: React.ReactNode; timestamp?: string; href?: string; note?: React.ReactNode }
export declare function Highlight(props: HighlightProps): React.ReactElement;

export interface QuestionItemProps { kind: 'what' | 'why' | 'who' | 'when' | 'where' | 'how'; question: string; status?: 'open' | 'answered'; answer?: React.ReactNode; topic?: string; age?: string }
export declare function QuestionItem(props: QuestionItemProps): React.ReactElement;

export type IconName = 'check' | 'play' | 'plus' | 'lock' | 'arrow' | 'arrowLeft' | 'chevronDown' | 'collapse' | 'expand' | 'external' | 'note' | 'comment' | 'image';
export interface IconProps { name: IconName; size?: number; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

/** Item da sidebar do app. */
export interface NavItemProps { label: React.ReactNode; href?: string; count?: number | string; active?: boolean }
export declare function NavItem(props: NavItemProps): React.ReactElement;

/** Cabeçalho de seção: título em heading + link "Ver todos" opcional + controle à direita. */
export interface SectionHeaderProps { title: React.ReactNode; id?: string; level?: 2 | 3; actionLabel?: string; actionHref?: string; trailing?: React.ReactNode }
export declare function SectionHeader(props: SectionHeaderProps): React.ReactElement;

export interface SegmentOption { value: string; label: React.ReactNode; count?: React.ReactNode }
/** Alterna modos de uma mesma área (Capas/Tabela, Leitura/Exercícios). Controlado (value) ou não (defaultValue). */
export interface SegmentedControlProps { options: SegmentOption[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; label?: string }
export declare function SegmentedControl(props: SegmentedControlProps): React.ReactElement;

export interface TabItem { value: string; label: React.ReactNode; count?: React.ReactNode; icon?: IconName }
/** Abas sublinhadas para alternar conteúdos de um painel. */
export interface TabsProps { items: TabItem[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; label?: string }
export declare function Tabs(props: TabsProps): React.ReactElement;

/** Campo de texto com label real. multiline vira textarea. */
export interface TextFieldProps { label: string; hideLabel?: boolean; id?: string; multiline?: boolean; rows?: number; placeholder?: string; defaultValue?: string; value?: string; onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>; hint?: string; mono?: boolean; inline?: boolean; width?: number | string; type?: string; className?: string }
export declare function TextField(props: TextFieldProps): React.ReactElement;

/** Card de coleção com capa (currículo, assunto). Sem cover: espaço "Foto de capa". */
export interface CoverCardProps { title: React.ReactNode; description?: React.ReactNode; meta?: React.ReactNode; href?: string; cover?: string; coverHeight?: number; className?: string }
export declare function CoverCard(props: CoverCardProps): React.ReactElement;

/** Linha horizontal de itens com setas que andam `step` itens por clique. */
export interface CarouselProps { children: React.ReactNode; itemWidth?: number; gap?: number; visible?: number; step?: number; arrowTop?: number; label?: string }
export declare function Carousel(props: CarouselProps): React.ReactElement;

/** Módulo recolhível de um currículo. children = corpo (intro, MaterialRow, exercícios, avaliação). */
export interface ModuleItemProps { label: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; status?: 'done' | 'current' | 'next'; statusText?: string; open?: boolean; defaultOpen?: boolean; onToggle?: (open: boolean) => void; children?: React.ReactNode }
export declare function ModuleItem(props: ModuleItemProps): React.ReactElement;

/** Material dentro de um módulo, na ordem de consumo. */
export interface MaterialRowProps { n: number; title: React.ReactNode; by?: React.ReactNode; type: string; optional?: boolean; status?: 'done' | 'current' | 'next' | 'skipped'; description?: React.ReactNode; href?: string; url?: string }
export declare function MaterialRow(props: MaterialRowProps): React.ReactElement;

/** Trecho destacado no leitor. note = número da nota de margem ligada. */
export interface MarkProps { children: React.ReactNode; note?: number; href?: string }
export declare function Mark(props: MarkProps): React.ReactElement;

export interface MarginNoteProps { n: number; id?: string; children: React.ReactNode }
export declare function MarginNote(props: MarginNoteProps): React.ReactElement;

/** Menu que aparece sobre uma seleção de texto. O consumidor posiciona. */
export interface SelectionToolbarProps { actions?: string[]; onAction?: (action: string) => void }
export declare function SelectionToolbar(props: SelectionToolbarProps): React.ReactElement;

/** Item da lista de anotações. kind é inferido: quote+note = linked, só quote = highlight, só note = loose. */
export interface AnnotationItemProps { kind?: 'linked' | 'highlight' | 'loose' | 'question'; quote?: React.ReactNode; note?: React.ReactNode; n?: number; location?: React.ReactNode; time?: string; onAddNote?: () => void }
export declare function AnnotationItem(props: AnnotationItemProps): React.ReactElement;

/** Um exercício. children = área de trabalho (TextField, Button) enquanto não estiver feito. */
export interface ExerciseItemProps { n: number; kind: string; prompt: React.ReactNode; done?: boolean; answer?: React.ReactNode; time?: string; children?: React.ReactNode }
export declare function ExerciseItem(props: ExerciseItemProps): React.ReactElement;

/** Painel lateral com abas, recolhível para um trilho de 48px. panels: conteúdo por aba. */
export interface SidePanelProps { tabs: TabItem[]; panels?: Record<string, React.ReactNode>; children?: React.ReactNode; value?: string; defaultValue?: string; onChange?: (value: string) => void; collapsed?: boolean; defaultCollapsed?: boolean; onCollapsedChange?: (collapsed: boolean) => void; label?: string }
export declare function SidePanel(props: SidePanelProps): React.ReactElement;

declare global { interface Window { Norte: { PageTitle: typeof PageTitle; Button: typeof Button; Tag: typeof Tag; SyncStatus: typeof SyncStatus; ProgressBar: typeof ProgressBar; Stat: typeof Stat; StreakGrid: typeof StreakGrid; TrailPath: typeof TrailPath; CourseRow: typeof CourseRow; Flashcard: typeof Flashcard; Highlight: typeof Highlight; QuestionItem: typeof QuestionItem; Icon: typeof Icon; NavItem: typeof NavItem; SectionHeader: typeof SectionHeader; SegmentedControl: typeof SegmentedControl; Tabs: typeof Tabs; TextField: typeof TextField; CoverCard: typeof CoverCard; Carousel: typeof Carousel; ModuleItem: typeof ModuleItem; MaterialRow: typeof MaterialRow; Mark: typeof Mark; MarginNote: typeof MarginNote; SelectionToolbar: typeof SelectionToolbar; AnnotationItem: typeof AnnotationItem; ExerciseItem: typeof ExerciseItem; SidePanel: typeof SidePanel } } }
