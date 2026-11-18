// 筛选界面（普通脚本，挂到 window 上，方便以后复用到别的页面）。
(function () {
  const STATUS_LABEL = {
    book: { wish: '想读', do: '在读', collect: '读过' },
    movie: { wish: '想看', do: '在看', collect: '看过' },
    all: { wish: '想读 / 想看', do: '在读 / 在看', collect: '读过 / 看过' },
  };
  const TABS = [['book', '书籍'], ['movie', '电影'], ['all', '全部']];

  function durationBucket(m) {
    if (!m) return [];
    if (m < 60) return ['60 分钟以内'];
    if (m <= 120) return ['60–120 分钟'];
    return ['120 分钟以上'];
  }

  // 每个筛选维度：从条目里取值的方法
  const FACETS = {
    myTags: { label: '我的标签', get: (i) => i.myTags },
    genres: { label: '类型', get: (i) => i.genres },
    countries: { label: '国家 / 地区', get: (i) => i.countries, limit: 20, search: true },
    languages: { label: '语言', get: (i) => i.languages, limit: 20, search: true },
    decade: { label: '年代', get: (i) => (i.decade ? [i.decade] : []), sort: 'name' },
    cast: { label: '演员', get: (i) => i.cast, people: true },
    directors: { label: '导演', get: (i) => i.directors, people: true },
    authors: { label: '作者', get: (i) => i.authors, people: true },
    publisher: { label: '出版社', get: (i) => (i.publisher ? [i.publisher] : []), search: true },
    rating: { label: '我的评分', get: (i) => (i.rating ? [`${i.rating} 星`] : []), sort: 'name' },
    duration: { label: '时长', get: (i) => durationBucket(i.durationMin), sort: 'name' },
  };
  const FACETS_BY_TAB = {
    book: ['myTags', 'countries', 'decade', 'authors', 'publisher', 'rating'],
    movie: ['myTags', 'genres', 'countries', 'languages', 'decade', 'cast', 'directors', 'duration', 'rating'],
    all: ['myTags', 'genres', 'countries', 'decade', 'cast', 'directors', 'authors', 'rating'],
  };
  const OPEN_BY_DEFAULT = new Set(['myTags', 'genres', 'countries', 'decade']);
  const CHIP_LIMIT = 12;
  const PEOPLE_TOP = 10;
  const PAGE = 50;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function loadUiState(persist) {
    if (!persist) return null;
    try { return JSON.parse(localStorage.getItem('dt_ui') || 'null'); } catch { return null; }
  }
  function saveUiState(persist, s) {
    if (!persist) return;
    try {
      localStorage.setItem('dt_ui', JSON.stringify({ tab: s.tab, status: s.status, open: [...s.open] }));
    } catch { /* 存不了就算了 */ }
  }

  function mount(root, items, opts = {}) {
    const saved = loadUiState(opts.persist) || {};
    const st = {
      items: items || [],
      tab: saved.tab || 'book',
      status: saved.status || 'wish',
      query: '',
      sel: new Map(), // facetKey -> Set(values)
      open: new Set(saved.open || OPEN_BY_DEFAULT),
      expanded: new Set(),
      facetQuery: {}, // 各分组里按回车提交的搜索词
      shown: PAGE,
    };

    function baseFilter(i) {
      if (st.tab !== 'all' && i.type !== st.tab) return false;
      if (st.status !== 'any' && i.status !== st.status) return false;
      if (st.query) {
        const q = st.query.toLowerCase();
        const hay = [i.titleFull, ...(i.cast || []), ...(i.directors || []), ...(i.authors || []), ...(i.myTags || [])]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }

    // 同一分组里选了多个：满足任意一个即可；不同分组之间：同时满足。
    // exceptFk：计算某个分组自己的候选标签时，不受这个分组已选标签的限制
    function selFilter(i, exceptFk) {
      for (const [fk, vals] of st.sel) {
        if (fk === exceptFk) continue;
        const have = FACETS[fk].get(i) || [];
        if (![...vals].some((v) => have.includes(v))) return false;
      }
      return true;
    }

    const facetList = (base, fk) => base.filter((i) => selFilter(i, fk));

    function counts(list, fk) {
      const m = new Map();
      for (const i of list) for (const v of FACETS[fk].get(i) || []) m.set(v, (m.get(v) || 0) + 1);
      const arr = [...m.entries()];
      if (FACETS[fk].sort === 'name') arr.sort((a, b) => String(b[0]).localeCompare(String(a[0]), 'zh'));
      else arr.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'zh'));
      return arr;
    }

    const isSel = (fk, v) => !!(st.sel.get(fk) && st.sel.get(fk).has(v));

    function chip(fk, v, n) {
      const on = isSel(fk, v);
      return `<button class="dt-chip${on ? ' on' : ''}" data-fk="${esc(fk)}" data-v="${esc(v)}">${esc(v)}`
        + `${n != null ? `<span class="dt-n">${n}</span>` : ''}</button>`;
    }

    function facetHtml(fk, list) {
      const f = FACETS[fk];
      let entries = counts(list, fk);
      const selected = [...(st.sel.get(fk) || [])];
      for (const v of selected) if (!entries.some((e) => e[0] === v)) entries.unshift([v, 0]);
      if (!entries.length) return '';

      const label = f.label.replace(/\s*\/.*$/, '');
      const searchable = f.people || (f.search && entries.length > (f.limit || CHIP_LIMIT));
      const q = (st.facetQuery[fk] || '').trim();
      let chipsHtml;
      let hint = '';
      if (q) {
        // 搜索了但有多个结果：列出全部匹配，让你点选
        const matches = entries.filter(([v]) => String(v).toLowerCase().includes(q.toLowerCase()));
        for (const v of selected) if (!matches.some((e) => e[0] === v)) matches.unshift(entries.find((e) => e[0] === v));
        chipsHtml = matches.map(([v, n]) => chip(fk, v, n)).join('');
        const found = matches.filter(([v]) => !isSel(fk, v)).length;
        hint = `<div class="dt-hint">${found ? `找到 ${found} 个包含"${esc(q)}"的${esc(label)}，点一下选中` : `没有找到"${esc(q)}"`}`
          + ` <button class="dt-qclear" data-fk="${esc(fk)}">清除搜索</button></div>`;
      } else if (f.people) {
        const top = entries.slice(0, PEOPLE_TOP);
        for (const v of selected) if (!top.some((e) => e[0] === v)) top.unshift(entries.find((e) => e[0] === v));
        chipsHtml = top.map(([v, n]) => chip(fk, v, n)).join('');
      } else {
        const limit = f.limit || CHIP_LIMIT;
        const all = st.expanded.has(fk);
        const vis = all ? entries.slice() : entries.slice(0, limit);
        for (const v of selected) if (!vis.some((e) => e[0] === v)) vis.push(entries.find((e) => e[0] === v));
        chipsHtml = vis.map(([v, n]) => chip(fk, v, n)).join('')
          + (entries.length > limit ? `<button class="dt-more" data-fk="${esc(fk)}">${all ? '收起' : `更多（${entries.length}）`}</button>` : '');
      }
      const body = `<div class="dt-chips">${chipsHtml}</div>${hint}`
        + (searchable ? `<input class="dt-people-q" data-fk="${esc(fk)}" placeholder="搜索${esc(label)}，按回车" enterkeyhint="search">` : '');
      const open = st.open.has(fk) || selected.length > 0;
      return `<details class="dt-facet" data-fk="${esc(fk)}"${open ? ' open' : ''}>`
        + `<summary>${esc(f.label)}${selected.length ? `<span class="dt-badge">${selected.length}</span>` : ''}</summary>${body}</details>`;
    }

    function statusText(i) {
      return STATUS_LABEL[i.type][i.status] || '';
    }

    function rowHtml(i) {
      const sub = i.type === 'movie'
        ? [i.year, (i.countries || []).slice(0, 2).join(' '), (i.genres || []).slice(0, 3).join(' ')]
        : [(i.authors || []).slice(0, 2).join('、'), i.publisher, i.year];
      const stars = i.rating ? `<span class="dt-stars">${'★'.repeat(i.rating)}</span>` : '';
      const initial = esc(String(i.title || '?').slice(0, 1));
      const cover = i.cover
        ? `<img src="${esc(i.cover)}" referrerpolicy="no-referrer" loading="lazy" alt="" data-fallback="${initial}">`
        : `<span>${initial}</span>`;
      return `<div class="dt-row">
        <div class="dt-cover dt-cover-${i.type}">${cover}</div>
        <div class="dt-info">
          <div class="dt-title" title="${esc(i.titleFull)}">${esc(i.title)}</div>
          <div class="dt-sub">${esc(sub.filter(Boolean).join(' · '))}</div>
          <div class="dt-meta"><span class="dt-st">${esc(statusText(i))}</span>${stars}
            <a href="${esc(i.url)}" target="_blank" rel="noopener">打开豆瓣 ↗</a></div>
        </div>
      </div>`;
    }

    function render() {
      // 重绘前记下当前各分组的展开状态（toggle 事件是异步的，可能还没触发）
      root.querySelectorAll('details.dt-facet').forEach((d) => {
        d.open ? st.open.add(d.dataset.fk) : st.open.delete(d.dataset.fk);
      });
      const base = st.items.filter(baseFilter);
      const res = base.filter(selFilter).sort((a, b) => String(b.markDate || '').localeCompare(String(a.markDate || '')));
      const labels = STATUS_LABEL[st.tab];
      const selChips = [...st.sel.entries()].flatMap(([fk, vals]) => [...vals].map((v) => chip(fk, v)));
      const unit = st.tab === 'movie' ? '部' : st.tab === 'book' ? '本' : '条';
      const statusWord = st.status === 'any' ? '' : labels[st.status];

      if (!st.items.length) {
        root.innerHTML = `<div class="dt dt-empty">${opts.emptyHtml || '还没有数据'}</div>`;
        return;
      }

      root.innerHTML = `<div class="dt">
        <div class="dt-tabs">${TABS.map(([k, n]) => `<button class="dt-tab${st.tab === k ? ' on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
        <div class="dt-pills">${['wish', 'collect', 'do', 'any'].map((s) => `<button class="dt-pill${st.status === s ? ' on' : ''}" data-status="${s}">${s === 'any' ? '全部' : esc(labels[s])}</button>`).join('')}</div>
        <input class="dt-search" type="search" placeholder="搜索标题、演员、作者，按回车" enterkeyhint="search" value="${esc(st.query)}">
        ${selChips.length ? `<div class="dt-selected">${selChips.join('')}<button class="dt-clear">清空</button></div>` : ''}
        <div class="dt-facets">${FACETS_BY_TAB[st.tab].map((fk) => facetHtml(fk, facetList(base, fk))).join('')}</div>
        <div class="dt-head">${selChips.length || st.query ? '符合条件' : '全部'} · ${res.length} ${unit}${esc(statusWord)}</div>
        <div class="dt-list">${res.slice(0, st.shown).map(rowHtml).join('') || '<div class="dt-muted">没有同时符合这些条件的条目</div>'}</div>
        ${res.length > st.shown ? `<button class="dt-showmore">再显示 ${Math.min(PAGE, res.length - st.shown)} 条</button>` : ''}
        ${opts.footerHtml || ''}
      </div>`;

      root.querySelectorAll('img[data-fallback]').forEach((img) => {
        img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: img.dataset.fallback })); }, { once: true });
      });
      saveUiState(opts.persist, st);
    }

    function keepFocus(selector, fn) {
      const el = root.querySelector(selector);
      const pos = el ? el.selectionStart : null;
      fn();
      const again = root.querySelector(selector);
      if (again) { again.focus(); if (pos != null) again.setSelectionRange(pos, pos); }
    }

    root.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || !root.contains(t)) return;
      if (t.dataset.tab) { st.tab = t.dataset.tab; st.shown = PAGE; }
      else if (t.dataset.status) { st.status = t.dataset.status; st.shown = PAGE; }
      else if (t.classList.contains('dt-chip')) {
        const { fk, v } = t.dataset;
        const set = st.sel.get(fk) || new Set();
        if (!set.has(v)) delete st.facetQuery[fk]; // 从搜索结果里选中后，收起搜索
        set.has(v) ? set.delete(v) : set.add(v);
        set.size ? st.sel.set(fk, set) : st.sel.delete(fk);
        st.shown = PAGE;
      } else if (t.classList.contains('dt-more')) {
        const fk = t.dataset.fk;
        st.expanded.has(fk) ? st.expanded.delete(fk) : st.expanded.add(fk);
      } else if (t.classList.contains('dt-qclear')) { delete st.facetQuery[t.dataset.fk]; }
      else if (t.classList.contains('dt-clear')) { st.sel.clear(); st.facetQuery = {}; st.shown = PAGE; }
      else if (t.classList.contains('dt-showmore')) { st.shown += PAGE; }
      else return;
      render();
    });

    root.addEventListener('toggle', (e) => {
      const d = e.target;
      if (!d.classList || !d.classList.contains('dt-facet')) return;
      d.open ? st.open.add(d.dataset.fk) : st.open.delete(d.dataset.fk);
      saveUiState(opts.persist, st);
    }, true);

    // 中文输入法组字期间（拼音还没选字），回车是选字，不是搜索
    let composing = false;
    root.addEventListener('compositionstart', () => { composing = true; });
    root.addEventListener('compositionend', () => { setTimeout(() => { composing = false; }, 0); });

    // 分组里的搜索：在"不受本组已选标签限制"的范围里找。
    // 只有一个匹配（或名字完全一致）就直接选中；多个就列出来点选；都没有就提示
    function commitFacetSearch(fk, raw) {
      const q = String(raw || '').trim();
      if (!q) { delete st.facetQuery[fk]; return; }
      const entries = counts(facetList(st.items.filter(baseFilter), fk), fk);
      const matches = entries.filter(([v]) => String(v).toLowerCase().includes(q.toLowerCase()));
      const exact = matches.find(([v]) => String(v) === q);
      const pick = exact || (matches.length === 1 ? matches[0] : null);
      if (pick) {
        const set = st.sel.get(fk) || new Set();
        set.add(pick[0]);
        st.sel.set(fk, set);
        delete st.facetQuery[fk];
        st.shown = PAGE;
      } else {
        st.facetQuery[fk] = q;
      }
    }

    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || composing || e.isComposing || e.keyCode === 229) return;
      const t = e.target;
      if (t.classList.contains('dt-search')) {
        e.preventDefault();
        st.query = t.value.trim(); st.shown = PAGE;
        keepFocus('.dt-search', render);
      } else if (t.classList.contains('dt-people-q')) {
        e.preventDefault();
        const fk = t.dataset.fk;
        commitFacetSearch(fk, t.value);
        render();
        const again = root.querySelector(`.dt-people-q[data-fk="${fk}"]`);
        if (again) again.focus(); // 方便接着搜下一个
      }
    });

    // 点搜索框里的 × 清空时，取消搜索
    root.addEventListener('search', (e) => {
      if (e.target.classList.contains('dt-search') && !e.target.value) { st.query = ''; render(); }
    }, true);

    // 后台同步刷新数据时，如果你正在输入框里打字，等离开输入框后再重绘
    let pendingRender = false;
    const typing = () => composing || (document.activeElement && root.contains(document.activeElement)
      && document.activeElement.tagName === 'INPUT');
    root.addEventListener('focusout', () => {
      setTimeout(() => { if (pendingRender && !typing()) { pendingRender = false; render(); } }, 0);
    });

    render();
    return {
      update(next) {
        st.items = next || [];
        if (typing()) { pendingRender = true; return; }
        render();
      },
    };
  }

  window.DoubanTagsUI = { mount };
})();
