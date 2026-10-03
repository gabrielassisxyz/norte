import type { VNode } from 'vue'

export type Renderable = string | number | VNode | VNode[] | null

export type IconName =
  | 'check'
  | 'play'
  | 'plus'
  | 'lock'
  | 'arrow'
  | 'arrowLeft'
  | 'chevronDown'
  | 'collapse'
  | 'expand'
  | 'external'
  | 'note'
  | 'comment'
  | 'image'

export interface PageTitleProps {
  title: Renderable
  objective?: Renderable
  meta?: Renderable
  actions?: Renderable
  className?: string
}

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'md' | 'sm'
  icon?: IconName
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
}

export interface TagProps {
  kind?: 'tag' | 'topic'
  active?: boolean
  count?: number
  onClick?: () => void
  className?: string
}

export interface SyncStatusProps {
  state?: 'saved' | 'syncing' | 'offline' | 'conflict'
  label?: string
}

export interface ProgressBarProps {
  value: number
  max?: number
  label?: string
  valueText?: string
  className?: string
}

export interface StatProps {
  value: Renderable
  unit?: string
  label: string
  delta?: string
  deltaTone?: 'up' | 'down'
}

export interface StreakGridProps {
  days: number[]
  label?: string
  caption?: string
}

export interface NavItemProps {
  label: Renderable
  href?: string
  count?: number | string
  active?: boolean
}

export interface SectionHeaderProps {
  title: Renderable
  id?: string
  level?: 2 | 3
  actionLabel?: string
  actionHref?: string
  trailing?: Renderable
}

export interface SegmentOption {
  value: string
  label: Renderable
  count?: Renderable
}

export interface SegmentedControlProps {
  options: SegmentOption[]
  modelValue?: string
  value?: string
  defaultValue?: string
  label?: string
  onChange?: (value: string) => void
}

export interface TabItem {
  value: string
  label: Renderable
  count?: Renderable
  icon?: IconName
}

export interface TabsProps {
  items: TabItem[]
  modelValue?: string
  value?: string
  defaultValue?: string
  label?: string
  onChange?: (value: string) => void
}

export interface TextFieldProps {
  label: string
  hideLabel?: boolean
  id?: string
  multiline?: boolean
  rows?: number
  placeholder?: string
  defaultValue?: string
  modelValue?: string
  value?: string
  hint?: string
  mono?: boolean
  inline?: boolean
  width?: number | string
  type?: string
  className?: string
  onChange?: (value: string) => void
}

export interface SidePanelProps {
  tabs: TabItem[]
  panels?: Record<string, Renderable>
  modelValue?: string
  value?: string
  defaultValue?: string
  collapsed?: boolean
  defaultCollapsed?: boolean
  label?: string
}
