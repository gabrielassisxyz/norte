import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MaterialRow from './MaterialRow.vue'

describe('MaterialRow', () => {
  it('renders the reader link, the author and the original link', () => {
    const wrapper = mount(MaterialRow, {
      props: {
        n: 2,
        title: 'Memória de trabalho',
        by: 'R. Nogueira',
        type: 'Livro',
        status: 'current',
        description: 'Capítulos 3 e 4.',
        href: '/material/livro/7',
        url: 'https://example.org/'
      }
    })

    expect(wrapper.find('.nt-mat-title').attributes('href')).toBe('/material/livro/7')
    expect(wrapper.find('.nt-mat-by').text()).toBe('R. Nogueira')
    expect(wrapper.find('.nt-mat-state').text()).toBe('Lendo agora')
    expect(wrapper.find('.nt-mat-node').text()).toBe('2')
    expect(wrapper.find('.nt-mat-ext').attributes('href')).toBe('https://example.org/')
  })

  it('appends opcional to the type and marks a skipped material', () => {
    const wrapper = mount(MaterialRow, {
      props: { n: 3, title: 'Entrevista', type: 'Palestra', optional: true, status: 'skipped' }
    })

    expect(wrapper.find('.nt-mat-type').text()).toBe('Palestra · opcional')
    expect(wrapper.find('.nt-mat-state').text()).toBe('Pulado')
    expect(wrapper.find('.nt-mat-ext').exists()).toBe(false)
  })

  it('swaps the number for a check once done', () => {
    const wrapper = mount(MaterialRow, { props: { n: 1, title: 'Post', type: 'Post', status: 'done' } })

    expect(wrapper.find('.nt-mat-node svg').exists()).toBe(true)
    expect(wrapper.find('.nt-mat-node').text()).toBe('Concluído')
  })
})
