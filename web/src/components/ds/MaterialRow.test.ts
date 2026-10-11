import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MaterialRow from './MaterialRow.vue'

describe('MaterialRow', () => {
  it('renders the reader link, the author and the original link', () => {
    const wrapper = mount(MaterialRow, {
      props: {
        n: 2,
        title: 'Working memory',
        by: 'R. Nogueira',
        type: 'Book',
        status: 'current',
        description: 'Chapters 3 and 4.',
        href: '/material/book/7',
        url: 'https://example.org/'
      }
    })

    expect(wrapper.find('.nt-mat-title').attributes('href')).toBe('/material/book/7')
    expect(wrapper.find('.nt-mat-by').text()).toBe('R. Nogueira')
    expect(wrapper.find('.nt-mat-state').text()).toBe('Reading now')
    expect(wrapper.find('.nt-mat-node').text()).toBe('2')
    expect(wrapper.find('.nt-mat-ext').attributes('href')).toBe('https://example.org/')
    expect(wrapper.find('.nt-mat-ext').attributes('aria-label')).toBe('Open the original material')
  })

  it('appends opcional to the type and marks a skipped material', () => {
    const wrapper = mount(MaterialRow, {
      props: { n: 3, title: 'Interview', type: 'Talk', optional: true, status: 'skipped' }
    })

    expect(wrapper.find('.nt-mat-type').text()).toBe('Talk · optional')
    expect(wrapper.find('.nt-mat-state').text()).toBe('Skipped')
    expect(wrapper.find('.nt-mat-ext').exists()).toBe(false)
  })

  it('swaps the number for a check once done', () => {
    const wrapper = mount(MaterialRow, { props: { n: 1, title: 'Post', type: 'Post', status: 'done' } })

    expect(wrapper.find('.nt-mat-node svg').exists()).toBe(true)
    expect(wrapper.find('.nt-mat-node').text()).toBe('Done')
  })
})
