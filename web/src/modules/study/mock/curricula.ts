import { createStandInLibraryItem, createUnreadStandInLibraryItem } from '@/mock/standins'
import type { Curriculum, LibraryItem } from '@/mock/types'

export const curricula: Curriculum[] = [
  {
    slug: 'compiler-fundamentals',
    title: 'Compiler fundamentals',
    goal: 'Build a small, readable interpreter.',
    status: 'active',
    currentModule: 'Module 1',
    currentLesson: 'Lexing and syntax',
    currentItem: 2,
    totalItems: 8,
    progress: 0.25,
    modules: [
      {
        id: 'mod-lexing',
        title: 'Lexing and syntax',
        summary: 'Turn text into verifiable structures before trying to run anything.',
        weeks: 4,
        materials: [
          { id: 'mat-symbols', libraryItemId: 'post-compilation', required: true },
          { id: 'mat-book-interpreters', libraryItemId: 'book-interpreters', required: true },
          { id: 'mat-parsing', libraryItemId: 'paper-parsing', required: false }
        ],
        exercises: [
          { id: 'ex-tokenizer', title: 'Write a tokenizer', prompt: 'Recognize numbers, names and operators.', completed: false },
          { id: 'ex-errors', title: 'Useful error messages', prompt: 'Point at the line and column of an unexpected character.', completed: false }
        ],
        instrument: {
          name: 'Instrument: token register',
          rows: [
            { key: 'Input', value: 'The piece of text read' },
            { key: 'Class', value: 'Number, name, operator or punctuation' },
            { key: 'Position', value: 'Starting line and column' },
            { key: 'Decision', value: 'Accept, discard or report an error' }
          ],
          note: 'Record the position from the first token on: rebuilding it later costs far more.'
        },
        evaluation: 'Given a file with a syntax error, produce the list of tokens up to the error and a message that points at where it is.'
      },
      {
        id: 'mod-trees',
        title: 'Trees and precedence',
        summary: 'Give the expression its shape before assigning meaning to it.',
        weeks: 5,
        materials: [
          { id: 'mat-trees-book', libraryItemId: 'book-interpreters', required: true },
          { id: 'mat-trees-paper', libraryItemId: 'paper-parsing', required: true },
          { id: 'mat-trees-git', libraryItemId: 'course-git', required: false }
        ],
        exercises: [
          { id: 'ex-precedence', title: 'A precedence table', prompt: 'Write the order of the operators and justify each position.', completed: false },
          { id: 'ex-ast', title: 'Build the tree', prompt: 'Convert three expressions into hand-drawn trees.', completed: false }
        ],
        evaluation: 'Explain, without consulting notes, why your tree evaluates a parenthesized expression in the right order.'
      },
      {
        id: 'mod-execution',
        title: 'Execution and scope',
        summary: 'Walk the tree keeping names and values where they belong.',
        weeks: 4,
        materials: [
          { id: 'mat-exec-post', libraryItemId: 'post-compilation', required: true },
          { id: 'mat-exec-book', libraryItemId: 'book-interpreters', required: true }
        ],
        exercises: [
          { id: 'ex-scope', title: 'Nested scopes', prompt: 'Resolve a name declared twice at different levels.', completed: false }
        ],
        instrument: {
          name: 'Instrument: symbol table',
          rows: [
            { key: 'Name', value: 'The declared identifier' },
            { key: 'Scope', value: 'Where the declaration holds' },
            { key: 'Type', value: 'What the name accepts' },
            { key: 'Origin', value: 'The position of the declaration' }
          ]
        },
        evaluation: 'Run a short program with nested functions and explain each name lookup the interpreter made.'
      },
      {
        id: 'mod-capstone',
        title: 'Final project: the whole language',
        summary: 'Join lexing, trees and execution into a program that runs end to end.',
        weeks: 2,
        materials: [],
        exercises: [
          { id: 'ex-final-language', title: 'Close the loop', prompt: 'Run a twenty-line program, from text to result.', completed: false }
        ],
        evaluation: 'The interpreter runs a program written by someone else, or points at where it is wrong.'
      }
    ]
  },
  {
    slug: 'practical-typography',
    title: 'Practical typography',
    goal: 'Choose and apply typefaces with intent.',
    status: 'active',
    currentModule: 'Module 1',
    currentLesson: 'Rhythm and hierarchy',
    currentItem: 1,
    totalItems: 5,
    progress: 0.2,
    modules: [
      {
        id: 'mod-rhythm',
        title: 'Rhythm and hierarchy',
        summary: 'Use space and scale to guide the reading instead of decorating the page.',
        weeks: 3,
        materials: [
          { id: 'mat-type-post', libraryItemId: 'post-typography', required: true },
          { id: 'mat-type-book', libraryItemId: 'book-type', required: false }
        ],
        exercises: [
          { id: 'ex-type-scale', title: 'Build a scale', prompt: 'Define titles and body text for a short page.', completed: true }
        ],
        instrument: {
          name: 'Instrument: the scale in use',
          rows: [
            { key: 'Role', value: 'Title, subtitle, body or support' },
            { key: 'Size', value: 'The value chosen from the scale' },
            { key: 'Leading', value: 'The matching line height' },
            { key: 'Reason', value: 'What the difference must communicate' }
          ],
          note: 'If a role changes nothing about the reading, it does not need a size of its own.'
        },
        evaluation: 'Apply the scale to a text you did not write and explain every difference in size.'
      },
      {
        id: 'mod-long-reading',
        title: 'Long-form reading',
        summary: 'Keep the eye on the line once the text goes past a few screens.',
        weeks: 3,
        materials: [
          { id: 'mat-long-book', libraryItemId: 'book-type', required: true },
          { id: 'mat-long-post', libraryItemId: 'post-typography', required: false }
        ],
        exercises: [
          { id: 'ex-measure', title: 'Find the measure', prompt: 'Compare three column widths by reading the same text aloud.', completed: false }
        ],
        evaluation: 'Justify the column width and the leading of a long text without falling back on personal preference.'
      },
      {
        id: 'mod-dense-ui',
        title: 'Dense interfaces',
        summary: 'Typography where tables, labels and numbers fight over the space.',
        weeks: 2,
        materials: [
          { id: 'mat-dense-post', libraryItemId: 'post-typography', required: true }
        ],
        exercises: [
          { id: 'ex-numbers', title: 'Aligned numbers', prompt: 'Align a column of values without increasing the line height.', completed: false }
        ],
        evaluation: 'A screen with a table, labels and titles, readable at two different window widths.'
      }
    ]
  },
  {
    slug: 'backyard-garden',
    title: 'Backyard garden',
    goal: 'Grow herbs and greens in the yard.',
    status: 'planned',
    modules: [
      {
        id: 'mod-soil',
        title: 'Soil and seeds',
        summary: 'Prepare the bed before planting anything.',
        weeks: 3,
        materials: [
          { id: 'mat-garden-post', libraryItemId: 'post-garden', required: true },
          { id: 'mat-garden-book', libraryItemId: 'book-garden', required: true },
          { id: 'mat-compost-paper', libraryItemId: 'paper-compost', required: false }
        ],
        exercises: [
          { id: 'ex-soil-log', title: 'Keep a soil log', prompt: 'Note the texture, the light and the drainage of one bed.', completed: false }
        ],
        instrument: {
          name: 'Instrument: the bed journal',
          rows: [
            { key: 'Date', value: 'When the observation was made' },
            { key: 'Light', value: 'Hours of direct sun on the spot' },
            { key: 'Water', value: 'How much and how often' },
            { key: 'Observation', value: 'What changed since the last entry' }
          ],
          note: 'A short entry once a week explains more than a long one once a season.'
        },
        evaluation: 'Describe the bed well enough for someone else to decide what to plant in it.'
      },
      {
        id: 'mod-watering',
        title: 'Watering and routine',
        summary: 'Turn the care into something that fits an ordinary week.',
        weeks: 4,
        materials: [
          { id: 'mat-watering-book', libraryItemId: 'book-garden', required: true },
          { id: 'mat-watering-compost', libraryItemId: 'paper-compost', required: false }
        ],
        exercises: [
          { id: 'ex-watering', title: 'Measure the watering', prompt: 'Record how much water the bed gets per week.', completed: false }
        ],
        evaluation: 'A watering routine that survives a busy week without losing plants.'
      },
      {
        id: 'mod-harvest',
        title: 'Harvest',
        summary: 'Cut at the right moment so the plant keeps producing.',
        weeks: 2,
        materials: [
          { id: 'mat-harvest-post', libraryItemId: 'post-garden', required: true }
        ],
        exercises: [
          { id: 'ex-harvest', title: 'First harvest', prompt: 'Pick a bunch of leaves without stopping the growth.', completed: false }
        ],
        evaluation: 'The same plant produces a second harvest after the first.'
      }
    ]
  },
  {
    slug: 'self-directed-learning',
    title: 'Self-directed learning',
    goal: 'Create short cycles of study and review.',
    status: 'planned',
    modules: [
      {
        id: 'mod-recall',
        title: 'Retrieval',
        summary: 'Practice remembering before rereading.',
        weeks: 4,
        materials: [
          { id: 'mat-reading-paper', libraryItemId: 'paper-reading', required: true },
          { id: 'mat-habits-podcast', libraryItemId: 'podcast-habits', required: false },
          { id: 'mat-writing-course', libraryItemId: 'course-writing', required: false }
        ],
        exercises: [
          { id: 'ex-recall', title: 'Retell it in your own words', prompt: 'Explain a recent idea in five sentences.', completed: false }
        ],
        instrument: {
          name: 'Instrument: separating study from evidence',
          rows: [
            { key: 'Study', value: 'Read, watch, note, look up' },
            { key: 'Evidence', value: 'Explain without consulting anything, solve something new, recall it a week later' }
          ],
          note: 'The feeling of having understood is not evidence of learning.'
        },
        evaluation: 'Explain a new subject on day 1 and on day 7, and compare the two explanations.'
      },
      {
        id: 'mod-spacing',
        title: 'Cycles and spacing',
        summary: 'Space the reviews out so that remembering costs some effort.',
        weeks: 3,
        materials: [
          { id: 'mat-spacing-paper', libraryItemId: 'paper-reading', required: true },
          { id: 'mat-spacing-podcast', libraryItemId: 'podcast-habits', required: true }
        ],
        exercises: [
          { id: 'ex-calibration', title: 'Calibrate your confidence', prompt: 'Estimate how much you will remember in seven days, then test it.', completed: false }
        ],
        evaluation: 'A week of reviews where the estimate and the result stay within 20% of each other.'
      }
    ]
  },
  {
    slug: 'connected-home',
    title: 'Connected home',
    goal: 'Organize simple services on the home network.',
    status: 'planned',
    modules: [
      {
        id: 'mod-lan',
        title: 'Local network',
        summary: 'Map the devices and services before adding one more.',
        weeks: 3,
        materials: [
          { id: 'mat-network-video', libraryItemId: 'video-network', required: true },
          { id: 'mat-server-podcast', libraryItemId: 'podcast-home-server', required: true }
        ],
        exercises: [
          { id: 'ex-network-map', title: 'Draw the map', prompt: 'List the devices and the role of each one.', completed: false }
        ],
        instrument: {
          name: 'Instrument: the network inventory',
          rows: [
            { key: 'Device', value: 'Name and type' },
            { key: 'Address', value: 'Fixed or assigned' },
            { key: 'Service', value: 'What it offers the house' },
            { key: 'Owner', value: 'Who notices first when it goes down' }
          ]
        },
        evaluation: 'The map answers, without consulting the router, what stops working when a device is switched off.'
      },
      {
        id: 'mod-services',
        title: 'Services that stay up',
        summary: 'Keep a service running without someone watching it every day.',
        weeks: 3,
        materials: [
          { id: 'mat-services-podcast', libraryItemId: 'podcast-home-server', required: true }
        ],
        exercises: [
          { id: 'ex-restart', title: 'Survive a restart', prompt: 'Restart the machine and check what came back on its own.', completed: false }
        ],
        evaluation: 'After a restart, every essential service comes back without intervention.'
      }
    ]
  },
  {
    slug: 'observational-drawing',
    title: 'Observational drawing',
    goal: 'Draw everyday objects with attention.',
    status: 'planned',
    modules: [
      {
        id: 'mod-forms',
        title: 'Basic forms',
        summary: 'Find the volumes before the details.',
        weeks: 3,
        materials: [
          { id: 'mat-sketch-video', libraryItemId: 'video-sketching', required: true },
          { id: 'mat-drawing-podcast', libraryItemId: 'podcast-drawing', required: false }
        ],
        exercises: [
          { id: 'ex-mug', title: 'Draw a mug', prompt: 'Make three studies of a mug under side light.', completed: false }
        ],
        evaluation: 'Three drawings of the same object where the volume is recognizable without a closed outline.'
      },
      {
        id: 'mod-light',
        title: 'Light and shadow',
        summary: 'Use value instead of line to describe the shape.',
        weeks: 3,
        materials: [
          { id: 'mat-light-video', libraryItemId: 'video-sketching', required: true }
        ],
        exercises: [
          { id: 'ex-value-scale', title: 'A value scale', prompt: 'Draw the same object with five values only.', completed: false }
        ],
        evaluation: 'A drawing where the direction of the light is obvious to someone who did not see the scene.'
      }
    ]
  },
  {
    slug: 'household-finances',
    title: 'Household finances',
    goal: 'Track expenses without complexity.',
    status: 'planned',
    modules: [
      {
        id: 'mod-cashflow',
        title: 'Monthly flow',
        summary: 'Record what comes in and what goes out with the least effort per week.',
        weeks: 3,
        materials: [
          { id: 'mat-budget-video', libraryItemId: 'video-budget', required: true },
          { id: 'mat-finance-course', libraryItemId: 'course-finance', required: true }
        ],
        exercises: [
          { id: 'ex-categories', title: 'Create categories', prompt: 'Group the last expenses into six categories.', completed: false }
        ],
        instrument: {
          name: 'Instrument: the month on one page',
          rows: [
            { key: 'Income', value: 'What came in and from where' },
            { key: 'Fixed', value: 'What leaves every month at the same value' },
            { key: 'Variable', value: 'What depends on the choices of the week' },
            { key: 'Cushion', value: 'What remained, before deciding where it goes' }
          ]
        },
        evaluation: 'One closed month where every expense fits one of the categories, without a "other" bucket.'
      },
      {
        id: 'mod-spending',
        title: 'Spending decisions',
        summary: 'Tell the spending that buys time from the one that buys comfort.',
        weeks: 2,
        materials: [
          { id: 'mat-spending-course', libraryItemId: 'course-finance', required: true }
        ],
        exercises: [
          { id: 'ex-tradeoff', title: 'Ten decisions', prompt: 'Rate ten recent purchases by what each one bought.', completed: false }
        ],
        evaluation: 'One page that explains what money is for in this house, with examples from the month itself.'
      }
    ]
  },
  {
    slug: 'everyday-cooking',
    title: 'Everyday cooking',
    goal: 'Cook simple meals during the week.',
    status: 'completed',
    modules: [
      {
        id: 'mod-base',
        title: 'Weekly staples',
        summary: 'Prepare versatile ingredients on a single day.',
        weeks: 2,
        materials: [],
        exercises: [
          { id: 'ex-menu', title: 'Plan four meals', prompt: 'Build a menu with repeated ingredients.', completed: true }
        ],
        evaluation: 'Four meals of the week come out of the same shopping.'
      }
    ]
  },
  {
    slug: 'studio-organization',
    title: 'Studio organization',
    goal: 'Keep the tools easy to find.',
    status: 'completed',
    modules: [
      {
        id: 'mod-zones',
        title: 'Work zones',
        summary: 'Separate storing, preparing and producing.',
        weeks: 1,
        materials: [],
        exercises: [
          { id: 'ex-zones', title: 'Mark the zones', prompt: 'Draw a simple map of the space.', completed: true }
        ],
        evaluation: 'Any tool goes back to its place without a new decision.'
      }
    ]
  }
]

/**
 * Stand-ins for every library item a curriculum module names, so this slice
 * stays readable on its own once the library's mock slice is deleted.
 */
/**
 * Which of the referenced items have been read.
 *
 * This is the study module's own fixture, not a copy of a library slice: the
 * curriculum screen derives every material's marker, each module's status and
 * the progress line from whether its item has been read, so the slice that
 * names the materials has to say which of them are behind the reader. The ones
 * left out sit unread in the inbox, which is what makes one of them current.
 */
const READ_MATERIAL_IDS = new Set([
  'post-garden',
  'book-type',
  'paper-reading',
  'paper-compost',
  'video-budget',
  'podcast-drawing',
  'course-finance',
  'course-writing'
])

export function buildStudyReferencedItems(today: string): LibraryItem[] {
  return [
    ...new Set(curricula.flatMap((curriculum) => curriculum.modules.flatMap((module) => module.materials.map((material) => material.libraryItemId))))
  ].map((id) =>
    READ_MATERIAL_IDS.has(id)
      ? createStandInLibraryItem(id, today)
      : createUnreadStandInLibraryItem(id, today)
  )
}