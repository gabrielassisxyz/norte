Norte is a personal course platform: a single place for trails, courses, topics, plans, spaced reviews, notes, and questions worth pursuing. Everything starts from an **objective** — each trail, course, and plan opens with what you want to be able to do by the end. The interface is quiet and precise; the title carries the page.

## Principles

1. **Objective first.** Every trail, course, or plan page opens with `PageTitle`: the title in `display`, right below it the objective sentence in `body-lg` / `ink-2` ("I want to be able to…"). Progress, tags, and actions come after.
2. **The title is the hero.** No hero, banner, or illustration. The `display` title (64px, Schibsted 750) with `space-16` above and `space-9` below is the focal moment. One per page.
3. **One accent, used sparingly.** `norte` (cobalt) marks what is current, actionable, or done. If everything is blue, nothing is. `lime` exists only as a highlighter.
4. **Local first, no ceremony.** The sync state appears small (`SyncStatus`), never as a modal. The app works offline; that needs no announcement.
5. **Honest density.** Lists are lists: rows separated by `line`, no cards. Numbers align in columns, in tabular mono. The exception is collections with a cover (curricula, topics), which use `CoverCard`.
6. **Little information at a time.** On the home screen and in cards, only what helps choose (cover, title, objective). Progress, counts, and "next" live on the collection page.
7. **Learn from memory.** Exercises live in their own tab, which hides the text and the annotations. No answering with the original beside it.

## Content and voice

- English, second person implied, short sentences. "Review 12 cards", not "Let's review your cards!".
- Sentence case everywhere: titles, buttons, tabs. Never forced ALL CAPS in labels.
- Buttons start with a verb: "Start review", "Add note", "Mark as done".
- Objectives are written as capability: "Be able to write a recursive parser", not "Learn parsers".
- Curiosity list questions follow 5W1H — What, Why, Who, When, Where, How — and end with "?".
- No emoji in the interface, no exclamation marks, no superlatives.
- Numbers: "3/12", "68%", "12:47", "42 days" — always in `data` or `metric`.

## Typography

- **Titles and UI:** Schibsted Grotesk (variable, `--font-display`). `display` for the page title, `title` for secondary pages, `heading` for sections, `subheading` for row and card titles, `label`/`label-sm` for every control.
- **Text:** Geist (variable, `--font-sans`). `body` for running text, always in a column of at most `65ch`, with 26px line spacing. `body-lg` for the objective line and long reading.
- **Mono:** Commit Mono (`--font-mono`; Iosevka and Cascadia Code as local fallback). Only for numbers, metrics, timestamps, percentages, and code. Always with `font-variant-numeric: tabular-nums`.
- Never serif in titles. Never decorative italic. Never Space Grotesk.
- Weights: titles between 650 and 750 with negative tracking; UI at 550; text at 400.

## Color

- The page background is `ground` (cold white). Panels and selectable rows in `surface`; sidebar, rails, and wells in `sunken`. Never warm off-white tints.
- Text: `ink` for titles and primary text, `ink-2` for descriptions, `muted` for metadata. All pass 4.5:1 over `ground`, `surface`, and `sunken` in both themes. Never gray text over a colored background.
- `norte` is the single accent: primary button, current trail entry, links (`link`), progress bar, focus ring (`focus`). Text over a norte fill uses `on-norte`, never a literal white (in the dark theme norte lightens and the text turns dark).
- `norte-soft` is the selection background; the text over it is `norte`.
- `lime` is only a highlighter: background of highlights (`Mark`, `AnnotationItem`, `Highlight`, the `SelectionToolbar` sample), with `on-lime` text. Never as text, border, or button.
- `success` (teal) and `danger` (red) only for state, always accompanied by a word or an icon. There is no warm warning color: late is `danger`, pending is `muted`.
- Streak: `streak-0` to `streak-4`, a ramp of cobalt itself. Do not use the default multicolor palette in charts; one series is `norte`, the comparison is `muted`.
- Forbidden: orange, terracotta, gradients (including purple→blue), text in gradients, glows, glassmorphism, decorative blur.

## Spacing and layout

- 4px base, deliberately uneven rhythm. Inside components: `space-1` to `space-4`. Between sections: `space-9`. Above the page title: `space-16`. Side gutter: `space-11`.
- Reading column: `max-width: 65ch`. List layouts may go up to 960px; never running text beyond 65ch.
- Default page structure: narrow sidebar in `sunken` → main column in `ground` with `PageTitle`, then sections separated by `heading`, not by cards.
- No nested cards. One panel (`surface` + `line` border + `radius-md`) holds rows; rows never become cards.
- Page sections open with `SectionHeader`: title + "See all" instead of counters. View controls (`SegmentedControl`) sit at the right of the same header.

## Covers and images

- Curricula and topics have a cover photo, ~3:2 ratio, `radius-md` corners, `line` border. The cover is the only box of the `CoverCard`; title and description sit loose below.
- Real photos, chosen by the user. No generic illustration, no gradient as a cover. No photo: the "Cover photo" placeholder in `sunken`.
- No other decorative image in the interface.

## Screen patterns

**Home (dashboard).** Sidebar (`NavItem`) → top bar with search, "Add" and one primary action ("Review 24 cards") → `PageTitle` with the date and the focus of the week → streak strip (`StreakGrid` + 4 `Stat`) between two `line` rows → Curricula in a `CoverCard` `Carousel` (4 visible + the edge of the fifth, moves 2 per click) → Topics in a 3-column `CoverCard` grid, with a "Covers / Table" `SegmentedControl`; the table shows counts by type in mono.

**Curriculum.** "Curricula / Name" breadcrumb and actions at the top → `PageTitle` with objective, one summary row in mono (duration, workload, materials) and the required `ProgressBar`; cover on the right → the central rule of the curriculum in 26px + the weekly load in `Stat` → "Path": a clickable module ruler → one `ModuleItem` per module, only the current one open, with `MaterialRow` entries, instrument, exercises, and assessment.

**Material reader.** Top bar: back to the module, position ("entry 2/7"), "Reading / Exercises" `SegmentedControl` in the center, complete action on the right.
- *Reading:* text in a 600–640px column with `Mark` and, at 40px, a 200px margin with `MarginNote` entries aligned to the paragraph. On the right, a `SidePanel` with Note and Annotations, collapsible to a 48px rail. Selecting text opens the `SelectionToolbar`.
- *Exercises:* text, margin, and panel disappear; a 680px column titled "Exercises", one row reminding the reader to answer from memory, and the `ExerciseItem` entries.
- Only the reader changes by type: **post** is an article (site, reading time, title in `title`); **book** has a bar with table of contents, search, typography, and bookmark, paginated text with paragraph indent, footer with `ProgressBar` and "p. 87 of 304"; **paper** shows the page in `surface` over `sunken`, title, authors, abstract, and two columns at 13.5px, with sections, pages, zoom, "Copy citation", and "Original PDF".
- The Note is a free-form document about the whole material; Annotations list three `AnnotationItem` shapes: linked to a passage (with margin number), highlight only, and loose ("No passage", or "No passage · became a question" once moved to the curiosity list).

## Borders, shadows, radii

- Separation comes from surfaces (`ground` vs `sunken`) and 1px `line` dividers. Control borders use `line-strong` (3:1).
- `shadow-pop` only on what floats (floating menu, popovers, command palette, `SelectionToolbar`, the `Carousel` arrows). Never the thin-border + wide diffuse shadow combination on resting cards.
- Small radii: `radius-sm` (5px) on controls and tags, `radius-md` (8px) at most for panels. `radius-full` only for progress tracks and status dots.
- No colored sidebar on cards, no rounded icon tile above titles, no "eyebrow" chip above the title.

## Motion

- Easing `cubic-bezier(0.2, 0, 0, 1)`, 120ms for hover/press, 200ms for open and close. No bounce, no elastic spring.
- Never animate layout width, height, or position; animate `opacity` and `transform`. The flashcard flip is a crossfade, not a 3D rotation.
- Respect `prefers-reduced-motion`: no transitions.

## Focus and accessibility

- Keyboard focus: `focus-ring` (2px of the background color, then 2px solid `focus`), via `box-shadow` to follow the radius. Always visible with `:focus-visible`.
- States never by color alone: done has ✓ or the word, current has a label, error has text.
- Touch targets at least 32px tall (buttons are 36px).

## Iconography

- 1.5px stroke, rounded corners and caps, 16px in the UI, 18–20px in the rail and the accordion, inheriting `currentColor`. `Norte.Icon` carries the icons used so far (check, play, plus, lock, arrow, arrowLeft, chevronDown, collapse, expand, external, note, comment, image). For others, use Lucide in the same stroke.
- Icons accompany text, never replace it in primary actions. No decorative icon above titles.
- No emoji.

## Components

`window.Norte` (React 18).

- **Structure:** `PageTitle` opens every page; `NavItem` builds the sidebar; `SectionHeader` opens each section.
- **Actions and fields:** `Button`, `SegmentedControl` (modes of one area), `Tabs` (contents of one panel), `TextField` (text and textarea with label), `Tag`, `SyncStatus`.
- **Progress:** `ProgressBar`, `Stat`, `StreakGrid`.
- **Collections:** `CoverCard` and `Carousel` for curricula and topics.
- **Trails and curricula:** `TrailPath`, `CourseRow`, `ModuleItem`, `MaterialRow`.
- **Reader:** `Mark` and `MarginNote` in the text, `SelectionToolbar` over the selection, `SidePanel` with Note and Annotations, `AnnotationItem` in the list, `ExerciseItem` in the exercise tab.
- **Review and curiosity:** `Flashcard` (Anki style), `Highlight` (passage with timestamp and note), `QuestionItem` (5W1H).

Not yet built: Select, CommandPalette, Dialog, the Note rich editor, CommunityPost. Build them with the same tokens before using them.
