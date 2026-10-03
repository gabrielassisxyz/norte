/* @ds-bundle: {"format":4,"namespace":"Norte","components":[{"name":"PageTitle"},{"name":"Button"},{"name":"Tag"},{"name":"SyncStatus"},{"name":"ProgressBar"},{"name":"Stat"},{"name":"StreakGrid"},{"name":"TrailPath"},{"name":"CourseRow"},{"name":"Flashcard"},{"name":"Highlight"},{"name":"QuestionItem"},{"name":"NavItem"},{"name":"SectionHeader"},{"name":"SegmentedControl"},{"name":"Tabs"},{"name":"TextField"},{"name":"CoverCard"},{"name":"Carousel"},{"name":"ModuleItem"},{"name":"MaterialRow"},{"name":"Mark"},{"name":"MarginNote"},{"name":"SelectionToolbar"},{"name":"AnnotationItem"},{"name":"ExerciseItem"},{"name":"SidePanel"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  function pct(v, max) { var m = max || 1; return Math.max(0, Math.min(100, Math.round((v / m) * 100))); }

  function Icon(props) {
    var paths = {
      check: 'M4 8.5l2.5 2.5L12 5.5',
      play: 'M5.5 3.5v9l7-4.5z',
      plus: 'M8 3.5v9M3.5 8h9',
      lock: 'M5 7V5.5a3 3 0 0 1 6 0V7M4 7h8v5.5H4z',
      arrow: 'M3.5 8h9M9 4.5L12.5 8 9 11.5',
      arrowLeft: 'M12.5 8h-9M7 4.5L3.5 8 7 11.5',
      chevronDown: 'M4.5 6.5L8 10l3.5-3.5',
      collapse: 'M4 4l4 4-4 4M9 4l4 4-4 4',
      expand: 'M12 4L8 8l4 4M7 4L3 8l4 4',
      external: 'M9.5 3.5h3v3M12.5 3.5L7 9M11 9.5v3H3.5V5h3',
      note: 'M4 2.5h5.5L12 5v8.5H4zM6 8h4M6 10.5h4',
      comment: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
      image: 'M2.5 3.5h11v9h-11zM13.5 10.5l-3-3-6.5 5M6 7.25h.01'
    };
    return h('svg', { className: cx('nt-icon', props.className), width: props.size || 16, height: props.size || 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      h('path', { d: paths[props.name] || '' }));
  }

  function PageTitle(p) {
    return h('header', { className: cx('nt-pagetitle', p.className) },
      h('h1', { className: 'nt-pagetitle-title' }, p.title),
      p.objective ? h('p', { className: 'nt-pagetitle-objective' }, p.objective) : null,
      (p.meta || p.actions) ? h('div', { className: 'nt-pagetitle-bar' },
        p.meta ? h('div', { className: 'nt-pagetitle-meta' }, p.meta) : h('span'),
        p.actions ? h('div', { className: 'nt-pagetitle-actions' }, p.actions) : null) : null);
  }

  function Button(p) {
    var variant = p.variant || 'secondary', size = p.size || 'md';
    var rest = Object.assign({}, p); delete rest.variant; delete rest.size; delete rest.icon; delete rest.className; delete rest.children;
    return h('button', Object.assign({ type: 'button' }, rest, { className: cx('nt-btn', 'nt-btn-' + variant, 'nt-btn-' + size, p.className) }),
      p.icon ? h(Icon, { name: p.icon }) : null, p.children);
  }

  function Tag(p) {
    var kind = p.kind || 'tag';
    var Comp = p.onClick ? 'button' : 'span';
    return h(Comp, { type: p.onClick ? 'button' : undefined, onClick: p.onClick, className: cx('nt-tag', 'nt-tag-' + kind, p.active && 'is-active', p.className) },
      kind === 'tag' ? h('span', { className: 'nt-tag-hash', 'aria-hidden': 'true' }, '#') : null, p.children,
      p.count != null ? h('span', { className: 'nt-tag-count' }, p.count) : null);
  }

  var SYNC = { saved: 'Salvo localmente', syncing: 'Sincronizando', offline: 'Offline · salvo local', conflict: 'Conflito para revisar' };
  function SyncStatus(p) {
    var state = p.state || 'saved';
    return h('span', { className: cx('nt-sync', 'nt-sync-' + state), role: 'status' },
      h('span', { className: 'nt-sync-dot', 'aria-hidden': 'true' }), p.label || SYNC[state]);
  }

  function ProgressBar(p) {
    var v = pct(p.value, p.max);
    return h('div', { className: cx('nt-progress', p.className) },
      p.label ? h('div', { className: 'nt-progress-head' },
        h('span', { className: 'nt-progress-label' }, p.label),
        h('span', { className: 'nt-progress-value' }, p.valueText || (v + '%'))) : null,
      h('div', { className: 'nt-progress-track', role: 'progressbar', 'aria-valuenow': v, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': p.label },
        h('div', { className: 'nt-progress-fill', style: { width: v + '%' } })));
  }

  function Stat(p) {
    return h('div', { className: 'nt-stat' },
      h('div', { className: 'nt-stat-value' }, p.value, p.unit ? h('span', { className: 'nt-stat-unit' }, p.unit) : null),
      h('div', { className: 'nt-stat-label' }, p.label),
      p.delta ? h('div', { className: cx('nt-stat-delta', p.deltaTone === 'down' && 'is-down') }, p.delta) : null);
  }

  function StreakGrid(p) {
    var days = p.days || [];
    return h('figure', { className: 'nt-streak' },
      h('div', { className: 'nt-streak-grid', role: 'img', 'aria-label': p.label || 'Histórico de estudo' },
        days.map(function (lv, i) { return h('span', { key: i, className: 'nt-streak-cell', 'data-level': Math.max(0, Math.min(4, lv | 0)) }); })),
      h('figcaption', { className: 'nt-streak-legend' },
        h('span', null, p.caption || ''),
        h('span', { className: 'nt-streak-scale', 'aria-hidden': 'true' }, 'menos',
          [0, 1, 2, 3, 4].map(function (l) { return h('span', { key: l, className: 'nt-streak-cell', 'data-level': l }); }), 'mais')));
  }

  var STEP = { done: 'Concluído', current: 'Agora', next: '', locked: 'Bloqueado' };
  function TrailPath(p) {
    return h('ol', { className: 'nt-trail' }, (p.steps || []).map(function (s, i) {
      var st = s.status || 'next';
      return h('li', { key: i, className: cx('nt-trail-step', 'is-' + st), 'aria-current': st === 'current' ? 'step' : undefined },
        h('span', { className: 'nt-trail-node', 'aria-hidden': 'true' },
          st === 'done' ? h(Icon, { name: 'check', size: 12 }) : st === 'locked' ? h(Icon, { name: 'lock', size: 12 }) : h('span', { className: 'nt-trail-index' }, i + 1)),
        h('div', { className: 'nt-trail-body' },
          h('div', { className: 'nt-trail-title' }, s.title,
            STEP[st] ? h('span', { className: 'nt-trail-status' }, STEP[st]) : null),
          s.meta ? h('div', { className: 'nt-trail-meta' }, s.meta) : null));
    }));
  }

  function CourseRow(p) {
    var v = pct(p.progress || 0, 1);
    return h('a', { href: p.href || '#', className: 'nt-course' },
      h('div', { className: 'nt-course-main' },
        h('div', { className: 'nt-course-title' }, p.title),
        h('div', { className: 'nt-course-sub' },
          p.topic ? h('span', null, p.topic) : null,
          p.source ? h('span', null, p.source) : null)),
      h('div', { className: 'nt-course-progress' },
        h('div', { className: 'nt-progress-track' }, h('div', { className: 'nt-progress-fill', style: { width: v + '%' } }))),
      h('span', { className: 'nt-course-num' }, p.lessons || (v + '%')),
      h('span', { className: 'nt-course-num nt-course-last' }, p.lastStudied || '—'));
  }

  var RATE = [['again', 'De novo'], ['hard', 'Difícil'], ['good', 'Bom'], ['easy', 'Fácil']];
  function Flashcard(p) {
    var st = React.useState(!!p.revealed), shown = st[0], setShown = st[1];
    var iv = p.intervals || ['1m', '6m', '1d', '4d'];
    return h('section', { className: 'nt-card', 'aria-label': 'Flashcard' },
      h('div', { className: 'nt-card-head' },
        h('span', null, p.deck),
        p.position ? h('span', { className: 'nt-card-pos' }, p.position) : null),
      h('div', { className: 'nt-card-front' }, p.front),
      shown
        ? h(React.Fragment, null,
            h('div', { className: 'nt-card-back' }, p.back),
            h('div', { className: 'nt-card-rate' }, RATE.map(function (r, i) {
              return h('button', { key: r[0], type: 'button', className: cx('nt-rate', 'nt-rate-' + r[0]), onClick: function () { p.onRate && p.onRate(r[0]); } },
                h('span', { className: 'nt-rate-label' }, r[1]), h('span', { className: 'nt-rate-iv' }, iv[i]));
            })))
        : h('div', { className: 'nt-card-reveal' },
            h(Button, { variant: 'primary', onClick: function () { setShown(true); p.onReveal && p.onReveal(); } }, 'Mostrar resposta'),
            h('span', { className: 'nt-kbd' }, 'espaço')));
  }

  function Highlight(p) {
    return h('figure', { className: 'nt-hl' },
      h('blockquote', { className: 'nt-hl-quote' }, h('mark', null, p.quote)),
      h('figcaption', { className: 'nt-hl-source' },
        p.timestamp ? h('a', { className: 'nt-hl-time', href: p.href || '#' }, h(Icon, { name: 'play', size: 12 }), p.timestamp) : null,
        h('span', null, p.source)),
      p.note ? h('p', { className: 'nt-hl-note' }, p.note) : null);
  }

  var W = { what: 'O quê', why: 'Por quê', who: 'Quem', when: 'Quando', where: 'Onde', how: 'Como' };
  function QuestionItem(p) {
    var answered = p.status === 'answered';
    return h('article', { className: cx('nt-q', answered && 'is-answered') },
      h('div', { className: 'nt-q-kind' }, W[p.kind] || p.kind),
      h('div', { className: 'nt-q-body' },
        h('div', { className: 'nt-q-text' }, p.question),
        answered && p.answer ? h('p', { className: 'nt-q-answer' }, p.answer) : null,
        h('div', { className: 'nt-q-meta' },
          answered ? h('span', { className: 'nt-q-state' }, h(Icon, { name: 'check', size: 12 }), 'Respondida') : h('span', null, 'Aberta'),
          p.topic ? h('span', null, p.topic) : null,
          p.age ? h('span', { className: 'nt-q-age' }, p.age) : null)));
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function useControlled(value, initial) {
    var st = React.useState(initial), inner = st[0], setInner = st[1];
    return [value !== undefined ? value : inner, setInner];
  }

  /* ---------- Navegação e estrutura ---------- */

  function NavItem(p) {
    return h('a', { href: p.href || '#', className: cx('nt-nav', p.active && 'is-active'), 'aria-current': p.active ? 'page' : undefined },
      h('span', { className: 'nt-nav-label' }, p.label || p.children),
      p.count != null ? h('span', { className: 'nt-nav-count' }, p.count) : null);
  }

  function SectionHeader(p) {
    var Tag_ = 'h' + (p.level || 2);
    return h('div', { className: 'nt-sechead' },
      h('div', { className: 'nt-sechead-main' },
        h(Tag_, { className: 'nt-sechead-title', id: p.id }, p.title),
        p.actionLabel ? h('a', { className: 'nt-sechead-link', href: p.actionHref || '#' }, p.actionLabel) : null),
      p.trailing ? h('div', { className: 'nt-sechead-trailing' }, p.trailing) : null);
  }

  function SegmentedControl(p) {
    var opts = p.options || [];
    var c = useControlled(p.value, p.defaultValue !== undefined ? p.defaultValue : (opts[0] && opts[0].value));
    return h('div', { className: 'nt-seg', role: 'tablist', 'aria-label': p.label },
      opts.map(function (o) {
        var on = o.value === c[0];
        return h('button', { key: o.value, type: 'button', role: 'tab', 'aria-selected': on, className: cx('nt-seg-btn', on && 'is-active'),
          onClick: function () { c[1](o.value); p.onChange && p.onChange(o.value); } },
          o.label, o.count != null ? h('span', { className: 'nt-seg-count' }, o.count) : null);
      }));
  }

  function Tabs(p) {
    var items = p.items || [];
    var c = useControlled(p.value, p.defaultValue !== undefined ? p.defaultValue : (items[0] && items[0].value));
    return h('div', { className: 'nt-tabs', role: 'tablist', 'aria-label': p.label },
      items.map(function (t) {
        var on = t.value === c[0];
        return h('button', { key: t.value, type: 'button', role: 'tab', 'aria-selected': on, className: cx('nt-tab', on && 'is-active'),
          onClick: function () { c[1](t.value); p.onChange && p.onChange(t.value); } },
          t.label, t.count != null ? h('span', { className: 'nt-tab-count' }, t.count) : null);
      }));
  }

  function TextField(p) {
    var autoId = React.useId ? React.useId() : 'nt-f';
    var id = p.id || autoId;
    var common = { id: id, className: cx('nt-input', p.multiline && 'nt-input-multi', p.mono && 'nt-input-mono'), placeholder: p.placeholder,
      defaultValue: p.defaultValue, value: p.value, onChange: p.onChange, 'aria-describedby': p.hint ? id + '-hint' : undefined };
    return h('div', { className: cx('nt-field', p.inline && 'nt-field-inline', p.className) },
      h('label', { htmlFor: id, className: cx('nt-field-label', p.hideLabel && 'nt-vh') }, p.label),
      p.multiline ? h('textarea', Object.assign({ rows: p.rows || 4 }, common)) : h('input', Object.assign({ type: p.type || 'text', style: p.width ? { width: p.width } : undefined }, common)),
      p.hint ? h('p', { id: id + '-hint', className: 'nt-field-hint' }, p.hint) : null);
  }

  /* ---------- Coleções ---------- */

  function CoverCard(p) {
    return h('a', { href: p.href || '#', className: cx('nt-cover-card', p.className) },
      h('div', { className: 'nt-cover', style: { height: p.coverHeight || 168 } },
        p.cover ? h('img', { src: p.cover, alt: '', className: 'nt-cover-img' })
          : h(React.Fragment, null, h(Icon, { name: 'image', size: 20 }), h('span', null, 'Foto de capa'))),
      h('div', null,
        h('div', { className: 'nt-cover-title' }, p.title),
        p.description ? h('p', { className: 'nt-cover-desc' }, p.description) : null,
        p.meta ? h('p', { className: 'nt-cover-meta' }, p.meta) : null));
  }

  function Carousel(p) {
    var kids = React.Children.toArray(p.children);
    var w = p.itemWidth || 248, gap = p.gap == null ? 24 : p.gap, visible = p.visible || 4, step = p.step || 2;
    var max = Math.max(0, kids.length - visible);
    var st = React.useState(0), idx = Math.min(st[0], max), setIdx = st[1];
    return h('div', { className: 'nt-carousel', role: 'region', 'aria-label': p.label || 'Carrossel' },
      h('div', { className: 'nt-carousel-viewport' },
        h('div', { className: 'nt-carousel-track', style: { gap: gap, transform: 'translateX(-' + idx * (w + gap) + 'px)' } },
          kids.map(function (k, i) { return h('div', { key: i, className: 'nt-carousel-item', style: { flex: '0 0 ' + w + 'px' } }, k); }))),
      idx > 0 ? h('button', { type: 'button', className: 'nt-carousel-btn is-prev', style: { top: p.arrowTop || 64 }, 'aria-label': 'Anteriores',
        onClick: function () { setIdx(Math.max(0, idx - step)); } }, h(Icon, { name: 'arrowLeft' })) : null,
      idx < max ? h('button', { type: 'button', className: 'nt-carousel-btn is-next', style: { top: p.arrowTop || 64 }, 'aria-label': 'Próximos',
        onClick: function () { setIdx(Math.min(max, idx + step)); } }, h(Icon, { name: 'arrow' })) : null);
  }

  function ModuleItem(p) {
    var c = useControlled(p.open, !!p.defaultOpen), open = c[0];
    var st = p.status || 'next';
    return h('section', { className: cx('nt-mod', 'is-' + st) },
      h('button', { type: 'button', className: 'nt-mod-head', 'aria-expanded': open,
        onClick: function () { c[1](!open); p.onToggle && p.onToggle(!open); } },
        h('span', { className: 'nt-mod-num' }, p.label),
        h('span', { style: { minWidth: 0 } },
          h('span', { className: 'nt-mod-title' }, p.title),
          p.meta ? h('span', { className: 'nt-mod-meta' }, p.meta) : null),
        h('span', { className: 'nt-mod-status' }, p.statusText || (st === 'done' ? 'Concluído' : '')),
        h(Icon, { name: 'chevronDown', size: 20, className: cx('nt-mod-chev', open && 'is-open') })),
      open ? h('div', { className: 'nt-mod-body' }, p.children) : null);
  }

  var MAT_STATUS = { current: 'Lendo agora', skipped: 'Pulado' };
  function MaterialRow(p) {
    var st = p.status || 'next';
    var node = st === 'done' ? h(Icon, { name: 'check', size: 12 }) : p.n;
    return h('div', { className: cx('nt-mat', 'is-' + st) },
      h('span', { className: 'nt-mat-node', title: st === 'done' ? 'Concluído' : undefined }, node,
        st === 'done' ? h('span', { className: 'nt-vh' }, 'Concluído') : null),
      h('div', { style: { minWidth: 0 } },
        h('div', { className: 'nt-mat-line' },
          h('a', { className: 'nt-mat-title', href: p.href || '#' }, p.title),
          p.by ? h('span', { className: 'nt-mat-by' }, p.by) : null,
          MAT_STATUS[st] ? h('span', { className: 'nt-mat-state' }, MAT_STATUS[st]) : null),
        p.description ? h('p', { className: 'nt-mat-desc' }, p.description) : null),
      h('span', { className: 'nt-mat-type' }, p.type, p.optional ? ' · opcional' : ''),
      p.url ? h('a', { className: 'nt-mat-ext', href: p.url, 'aria-label': 'Abrir material original' }, h(Icon, { name: 'external' })) : h('span'));
  }

  /* ---------- Leitor ---------- */

  function Mark(p) {
    return h(React.Fragment, null,
      h('mark', { className: 'nt-mark' }, p.children),
      p.note != null ? h('a', { className: 'nt-mark-ref', href: p.href || '#nota-' + p.note, 'aria-label': 'Anotação ' + p.note }, p.note) : null);
  }

  function MarginNote(p) {
    return h('div', { className: 'nt-mnote', id: p.id || (p.n != null ? 'nota-' + p.n : undefined) },
      h('span', { className: 'nt-mnote-n' }, p.n), h('span', null, p.children));
  }

  var SEL_ACTIONS = ['Destacar', 'Anotar', 'Virar pergunta', 'Criar cartão'];
  function SelectionToolbar(p) {
    var actions = p.actions || SEL_ACTIONS;
    return h('div', { className: 'nt-seltool', role: 'toolbar', 'aria-label': 'Ações para o trecho selecionado' },
      actions.map(function (a, i) {
        return h('button', { key: a, type: 'button', className: 'nt-seltool-btn', onClick: function () { p.onAction && p.onAction(a); } },
          i === 0 ? h('span', { className: 'nt-swatch', 'aria-hidden': 'true' }) : null, a);
      }));
  }

  function AnnotationItem(p) {
    var kind = p.kind || (p.quote ? (p.note ? 'linked' : 'highlight') : 'loose');
    var badge = kind === 'loose' ? 'Sem trecho' : kind === 'question' ? 'Sem trecho · virou pergunta' : null;
    return h('div', { className: 'nt-ann' },
      badge ? h('span', { className: 'nt-ann-badge' }, badge) : null,
      p.quote ? h('p', { className: 'nt-ann-quote' }, h('mark', { className: 'nt-mark' }, p.quote)) : null,
      p.note ? h('p', { className: 'nt-ann-note' }, p.note) : null,
      h('div', { className: 'nt-ann-meta' },
        p.n != null ? h('span', { className: 'nt-ann-n' }, p.n) : null,
        kind === 'highlight' ? h('span', null, 'Só destaque') : null,
        p.location ? h('span', null, p.location) : null,
        p.time ? h('span', { className: 'nt-mono' }, p.time) : null),
      kind === 'highlight' ? h('button', { type: 'button', className: 'nt-ann-add', onClick: p.onAddNote }, '+ Anotar este trecho') : null);
  }

  function ExerciseItem(p) {
    return h('div', { className: cx('nt-ex', p.done && 'is-done') },
      h('span', { className: 'nt-ex-n' }, p.done ? h(Icon, { name: 'check', size: 14 }) : pad2(p.n || 1),
        p.done ? h('span', { className: 'nt-vh' }, 'Feito') : null),
      h('div', { style: { minWidth: 0 } },
        h('div', { className: 'nt-ex-kind' }, p.kind),
        h('p', { className: 'nt-ex-prompt' }, p.prompt),
        p.done && p.answer ? h('p', { className: 'nt-ex-answer' }, p.answer) : null,
        !p.done && p.children ? h('div', { className: 'nt-ex-work' }, p.children) : null,
        p.done ? h('div', { className: 'nt-ex-meta' }, h('span', { className: 'nt-ex-ok' }, 'Feito'), p.time ? h('span', { className: 'nt-mono' }, p.time) : null) : null));
  }

  function SidePanel(p) {
    var tabs = p.tabs || [];
    var t = useControlled(p.value, p.defaultValue !== undefined ? p.defaultValue : (tabs[0] && tabs[0].value));
    var c = useControlled(p.collapsed, !!p.defaultCollapsed);
    function setCollapsed(v) { c[1](v); p.onCollapsedChange && p.onCollapsedChange(v); }
    function setTab(v) { t[1](v); p.onChange && p.onChange(v); }
    var panels = p.panels || {};
    if (c[0]) {
      return h('aside', { className: 'nt-rail', 'aria-label': (p.label || 'Painel') + ' recolhido' },
        h('button', { type: 'button', className: 'nt-rail-btn', 'aria-label': 'Abrir painel', onClick: function () { setCollapsed(false); } }, h(Icon, { name: 'expand' })),
        h('span', { className: 'nt-rail-sep', 'aria-hidden': 'true' }),
        tabs.map(function (tb) {
          return h('button', { key: tb.value, type: 'button', className: 'nt-rail-btn', 'aria-label': 'Abrir ' + tb.label + (tb.count != null ? ', ' + tb.count : ''),
            onClick: function () { setTab(tb.value); setCollapsed(false); } },
            h(Icon, { name: tb.icon || 'note', size: 18 }), tb.count != null ? h('span', { className: 'nt-rail-count' }, tb.count) : null);
        }));
    }
    return h('aside', { className: 'nt-panel', 'aria-label': p.label || 'Painel' },
      h('div', { className: 'nt-panel-head' },
        h(Tabs, { items: tabs, value: t[0], onChange: setTab, label: p.label }),
        h('button', { type: 'button', className: 'nt-icon-btn', 'aria-label': 'Recolher painel', onClick: function () { setCollapsed(true); } }, h(Icon, { name: 'collapse' }))),
      h('div', { className: 'nt-panel-body', role: 'tabpanel' }, panels[t[0]] || p.children));
  }

  window.Norte = Object.assign(window.Norte || {}, {
    PageTitle: PageTitle, Button: Button, Tag: Tag, SyncStatus: SyncStatus, ProgressBar: ProgressBar, Stat: Stat,
    StreakGrid: StreakGrid, TrailPath: TrailPath, CourseRow: CourseRow, Flashcard: Flashcard, Highlight: Highlight,
    QuestionItem: QuestionItem, Icon: Icon,
    NavItem: NavItem, SectionHeader: SectionHeader, SegmentedControl: SegmentedControl, Tabs: Tabs, TextField: TextField,
    CoverCard: CoverCard, Carousel: Carousel, ModuleItem: ModuleItem, MaterialRow: MaterialRow,
    Mark: Mark, MarginNote: MarginNote, SelectionToolbar: SelectionToolbar, AnnotationItem: AnnotationItem,
    ExerciseItem: ExerciseItem, SidePanel: SidePanel
  });
})();
