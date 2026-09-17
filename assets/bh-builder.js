/**
 * BH BEER BUILDER  v1.0  (2026-09-16)
 * ---------------------------------------------------------------------------
 * Client for the Brew Hunters build-your-own beer box.
 *
 * Port of BroBasket's assets/bb-builder.js (jgrasty123/Shopify_Brobasket).
 * The architecture is unchanged:
 *
 *   THE URL IS THE QUERY. Filter state is never posted anywhere. The client
 *   builds a collection or search URL with ?section_id=bh-builder-grid and
 *   renders what comes back. Pagination, sorting and search are Shopify's.
 *
 *   ORDINARY LINES IN AN ORDINARY CART. Each picked can is added as its own
 *   line at its own price, carrying `Bundle`, `Box ID` and `Box Size`
 *   properties. No bundle engine, no parent SKU, no Cart Transform.
 *
 * Differences from BroBasket:
 *   - A `size` step: the customer picks a box size and the beer step then
 *     requires exactly that many cans (min === max === size). Each box keeps
 *     its own size, so a 6 and a 12 can sit in the same cart.
 *   - No greeting-card grid, no basket-container step.
 *   - No adult-signature fee. Brew Hunters has no fee SKU; the notice from
 *     theme settings is shown on the review step instead.
 *   - After adding, the theme's side cart opens instead of redirecting to /cart.
 *
 * DEBUG
 *   window.__bhBuilder.state()
 *   window.__bbBuilderVerbose = true
 */
(function () {
  'use strict';

  var LOG = '[bh-builder]';
  var GRID_SECTION = 'bh-builder-grid';
  var SEARCH_DEBOUNCE_MS = 300;

  var root = document.querySelector('[data-bb-builder]');
  if (!root) return;

  var configNode = document.querySelector('script[data-bh-builder-config]');
  if (!configNode) { console.warn(LOG, 'config node missing; builder inert'); return; }

  var CONFIG;
  try {
    CONFIG = JSON.parse(configNode.textContent);
  } catch (e) {
    console.warn(LOG, 'config unparseable; builder inert', e);
    return;
  }
  if (!CONFIG.steps || !CONFIG.steps.length) { console.warn(LOG, 'config has no steps'); return; }
  if (!CONFIG.sizes || !CONFIG.sizes.length) CONFIG.sizes = [6, 12];

  var ROOT_URL = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

  var els = {
    steps: root.querySelector('[data-bb-steps]'),
    sizes: root.querySelector('[data-bb-sizes]'),
    sizeOptions: root.querySelector('[data-bb-size-options]'),
    toolbar: root.querySelector('[data-bb-toolbar]'),
    search: root.querySelector('[data-bb-search]'),
    status: root.querySelector('[data-bb-status]'),
    mount: root.querySelector('[data-bb-grid-mount]'),
    loadMore: root.querySelector('[data-bb-load-more]'),
    next: root.querySelector('[data-bb-next]'),
    back: root.querySelector('[data-bb-back]'),
    nextInline: root.querySelector('[data-bb-next-inline]'),
    backInline: root.querySelector('[data-bb-back-inline]'),
    navHint: root.querySelector('[data-bb-nav-hint]'),
    addBox: root.querySelector('[data-bb-add-box]'),
    filtersOpen: root.querySelector('[data-bb-filters-open]'),
    filterCount: root.querySelector('[data-bb-filter-count]'),
    filterGroups: root.querySelector('[data-bb-filter-groups]'),
    drawer: root.querySelector('[data-bb-drawer]'),
    box: root.querySelector('[data-bb-box]'),
    boxEmpty: root.querySelector('[data-bb-box-empty]'),
    boxCount: root.querySelector('[data-bb-box-count]'),
    boxTotal: root.querySelector('[data-bb-box-total]'),
    boxLabel: root.querySelector('[data-bb-box-label]'),
    message: root.querySelector('[data-bb-message]'),
    msgTo: root.querySelector('[data-bb-msg-to]'),
    msgBody: root.querySelector('[data-bb-msg-body]'),
    msgFrom: root.querySelector('[data-bb-msg-from]'),
    msgRemaining: root.querySelector('[data-bb-msg-remaining]'),
    qv: root.querySelector('[data-bb-qv]'),
    qvBody: root.querySelector('[data-bb-qv-body]'),
    summary: root.querySelector('[data-bb-summary-panel]')
  };

  var qvCache = Object.create(null);
  var qvReturnFocus = null;
  var qvCard = null;

  function money(cents) { return '$' + (cents / 100).toFixed(2); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function log() {
    if (!window.__bbBuilderVerbose) return;
    try { console.log.apply(console, [LOG].concat([].slice.call(arguments))); } catch (e) {}
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var state = {
    stepIndex: 0,
    filters: [],
    query: '',
    sourceIndex: 0,
    page: 1,
    hasNext: false,
    seen: Object.create(null),
    loading: false,
    token: 0,
    box: [],              // [{variantId, productId, title, vendor, price, image, step, boxId, qty}]
    boxId: 1,
    sizes: {},            // boxId -> can count
    advanced: {},         // 'boxId:stepIndex' -> already auto-advanced once
    advanceTimer: null,
    submitting: false
  };

  function currentStep() { return CONFIG.steps[state.stepIndex]; }
  function boxSize(boxId) { return state.sizes[boxId || state.boxId] || 0; }

  /** Resolve a step's minimum; "size" means the current box's can count. */
  function stepMin(st) {
    if (!st) return 0;
    if (st.min === 'size') return boxSize();
    return Number(st.min) || 0;
  }
  function stepMax(st) {
    return st && st.min === 'size' ? boxSize() : Infinity;
  }

  function activeSources() {
    if (state.filters.length) return state.filters.map(function (h) { return { handle: h }; });
    return currentStep().sources || [];
  }

  // ── URL + fetch ───────────────────────────────────────────────────────────
  function buildUrl() {
    var url;
    if (state.query) {
      url = new URL(ROOT_URL + 'search', window.location.origin);
      url.searchParams.set('q', state.query);
      url.searchParams.set('type', 'product');
    } else {
      var src = activeSources()[state.sourceIndex];
      if (!src) return null;
      url = new URL(ROOT_URL + 'collections/' + src.handle, window.location.origin);
    }
    url.searchParams.set('section_id', GRID_SECTION);
    if (state.page > 1) url.searchParams.set('page', String(state.page));
    return url.toString();
  }

  function fetchPage() {
    var url = buildUrl();
    if (!url) return Promise.resolve(null);
    return fetch(url, { headers: { Accept: 'text/html' } })
      .then(function (res) {
        if (!res.ok) throw new Error('grid fetch ' + res.status);
        return res.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var metaNode = doc.querySelector('[data-bb-grid-meta]');
        var meta = null;
        try { meta = metaNode ? JSON.parse(metaNode.textContent) : null; } catch (e) { log('meta unparseable', e); }
        return { meta: meta, items: doc.querySelectorAll('[data-bb-product]') };
      });
  }

  function appendItems(nodes) {
    var list = els.mount.querySelector('[data-bb-grid]');
    if (!list) {
      list = document.createElement('ul');
      list.className = 'bhb-grid';
      list.setAttribute('data-bb-grid', '');
      list.setAttribute('role', 'list');
      els.mount.appendChild(list);
    }
    var added = 0;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var id = node.getAttribute('data-product-id');
      if (!id || state.seen[id]) continue;
      state.seen[id] = true;
      var card = document.importNode(node, true);
      var qty = document.createElement('div');
      qty.className = 'bhb-card__qty qty';
      qty.innerHTML =
        '<button type="button" data-bb-qty="-1" aria-label="Remove one">&minus;</button>' +
        '<output data-bb-qty-value>1</output>' +
        '<button type="button" data-bb-qty="1" aria-label="Add one">+</button>';
      card.appendChild(qty);
      list.appendChild(card);
      added++;
    }
    syncCards();
    return added;
  }

  function loadMore() {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    var token = state.token;
    setStatus('Loading…');

    return fetchPage()
      .then(function (result) {
        if (token !== state.token) return;
        if (!result) { state.hasNext = false; return; }
        var added = appendItems(result.items);
        var meta = result.meta || {};
        if (meta.has_next) {
          state.page = meta.next_page;
          state.hasNext = true;
        } else if (!state.query) {
          state.sourceIndex++;
          state.page = 1;
          state.hasNext = state.sourceIndex < activeSources().length;
        } else {
          state.hasNext = false;
        }
        log('page loaded', { added: added, meta: meta, hasNext: state.hasNext });
        if (added === 0 && state.hasNext) {
          state.loading = false;
          return loadMore();
        }
      })
      .catch(function (err) {
        if (token !== state.token) return;
        console.warn(LOG, 'load failed', err);
        setStatus('Could not load beers. Try again.');
      })
      .then(function () {
        if (token !== state.token) return;
        state.loading = false;
        els.loadMore.hidden = !state.hasNext;
        var count = els.mount.querySelectorAll('[data-bb-product]').length;
        setStatus(count ? count + ' beer' + (count === 1 ? '' : 's') : 'Nothing found.');
      });
  }

  function setStatus(text) { if (els.status) els.status.textContent = text; }

  function reset() {
    state.token++;
    state.sourceIndex = 0;
    state.page = 1;
    state.hasNext = false;
    state.seen = Object.create(null);
    state.loading = false;
    els.mount.innerHTML = '';
    els.loadMore.hidden = true;
  }

  function navigate() { reset(); return loadMore(); }

  // ── Steps ─────────────────────────────────────────────────────────────────
  function stepSatisfied(index) {
    var st = CONFIG.steps[index];
    if (!st) return true;
    if (st.type === 'size') return boxSize() > 0;
    var min = stepMin(st);
    if (!min) return true;
    return boxCountForStep(index) >= min;
  }

  function boxCountForStep(index) {
    var key = CONFIG.steps[index].key;
    return currentBoxItems().reduce(function (n, item) {
      return item.step === key ? n + item.qty : n;
    }, 0);
  }

  function renderSteps() {
    // A later step is reachable only when every earlier step is satisfied.
    var firstUnsatisfied = CONFIG.steps.length;
    for (var j = 0; j < CONFIG.steps.length; j++) {
      if (!stepSatisfied(j)) { firstUnsatisfied = j; break; }
    }
    els.steps.innerHTML = CONFIG.steps.map(function (st, i) {
      var cls = 'bhb-step';
      if (i === state.stepIndex) cls += ' is-active';
      else if (i < state.stepIndex) cls += ' is-complete';
      var locked = i > firstUnsatisfied;
      return '<button type="button" class="' + cls + '" data-bb-step="' + st.key + '"' +
        (locked ? ' disabled' : '') +
        ' aria-current="' + (i === state.stepIndex ? 'step' : 'false') + '">' +
        '<span class="bhb-step__num">' + (i + 1) + '</span>' +
        '<span class="bhb-step__name">' + escapeHtml(st.name) + '</span>' +
        '</button>';
    }).join('');
  }

  function renderSizes() {
    els.sizeOptions.innerHTML = CONFIG.sizes.map(function (n) {
      var on = boxSize() === n;
      return '<button type="button" class="bhb-size' + (on ? ' is-selected' : '') + '" data-bb-size="' + n + '" aria-pressed="' + on + '">' +
        '<b>' + n + '</b><span>cans</span></button>';
    }).join('');
  }

  function setSize(n) {
    var prev = boxSize();
    if (prev === n) return;
    // Shrinking a box that already holds more cans than the new size would
    // leave it impossible to complete. Trim from the most recently added.
    var items = currentBoxItems();
    var total = items.reduce(function (s, b) { return s + b.qty; }, 0);
    var over = total - n;
    for (var i = items.length - 1; i >= 0 && over > 0; i--) {
      var take = Math.min(items[i].qty, over);
      items[i].qty -= take;
      over -= take;
    }
    state.box = state.box.filter(function (b) { return b.qty > 0; });
    state.sizes[state.boxId] = n;
    renderSizes();
    renderBox();
    syncCards();
    if (total > n) setStatus('Box resized to ' + n + '. Removed ' + (total - n) + ' can' + (total - n === 1 ? '' : 's') + '.');
    if (currentStep().type === 'size') autoAdvance('Box size ' + n + '. Now pick your beers.');
  }

  // ── Filters ───────────────────────────────────────────────────────────────
  function renderFilters() {
    var groups = currentStep().filterGroups || [];
    if (!groups.length || currentStep().type !== 'products') {
      els.filtersOpen.hidden = true;
      els.filterGroups.innerHTML = '';
      return;
    }
    els.filtersOpen.hidden = false;
    els.filterGroups.innerHTML = groups.map(function (g, gi) {
      var opts = g.options.map(function (o) {
        var checked = state.filters.indexOf(o.handle) !== -1;
        return '<label class="bhb-fopt">' +
          '<input type="checkbox" data-bb-filter="' + escapeHtml(o.handle) + '"' + (checked ? ' checked' : '') + '>' +
          '<span>' + escapeHtml(o.title.replace(/^BYO\s*[-–·:]\s*/i, '')) + '</span>' +
          '<span class="bhb-fopt__count">' + o.count + '</span>' +
          '</label>';
      }).join('');
      return '<div class="bhb-fgroup' + (gi === 0 ? ' is-open' : '') + '">' +
        '<button type="button" class="bhb-fgroup__head" data-bb-fgroup-toggle>' +
        '<span>' + escapeHtml(g.label) + '</span><span aria-hidden="true" class="bhb-fgroup__chev">+</span>' +
        '</button>' +
        '<div class="bhb-fgroup__body">' + opts + '</div>' +
        '</div>';
    }).join('');
    updateFilterCount();
  }

  function updateFilterCount() {
    var n = state.filters.length;
    els.filterCount.hidden = n === 0;
    els.filterCount.textContent = String(n);
  }

  function toggleFilter(handle, on) {
    var i = state.filters.indexOf(handle);
    if (on && i === -1) state.filters.push(handle);
    if (!on && i !== -1) state.filters.splice(i, 1);
    state.query = '';
    if (els.search) els.search.value = '';
    updateFilterCount();
    navigate();
  }

  function clearFilters() {
    state.filters = [];
    renderFilters();
    navigate();
  }

  function openDrawer(open) {
    root.classList.toggle('is-filtering', open);
    els.drawer.hidden = !open;
    root.querySelectorAll('[data-bb-filters-close]').forEach(function (n) { n.hidden = !open; });
  }

  // ── Box ───────────────────────────────────────────────────────────────────
  function findInBox(variantId, boxId) {
    var id = boxId || state.boxId;
    for (var i = 0; i < state.box.length; i++) {
      if (state.box[i].variantId === variantId && state.box[i].boxId === id) return state.box[i];
    }
    return null;
  }

  function currentBoxItems() {
    return state.box.filter(function (b) { return b.boxId === state.boxId; });
  }

  function currentBoxCount() {
    return currentBoxItems().reduce(function (n, b) { return n + b.qty; }, 0);
  }

  function boxIsFull() {
    var max = stepMax(currentStep());
    return max !== Infinity && boxCountForStep(state.stepIndex) >= max;
  }

  function addToBox(card) {
    if (!boxSize()) { goToStep(0); setStatus('Pick a box size first.'); return; }
    if (boxIsFull()) {
      setStatus('Your box is full. Remove a can to swap it out.');
      return;
    }
    var variantId = card.getAttribute('data-variant-id');
    var existing = findInBox(variantId);
    if (existing) {
      existing.qty++;
    } else {
      var img = card.querySelector('img');
      state.box.push({
        variantId: variantId,
        productId: card.getAttribute('data-product-id'),
        title: card.getAttribute('data-title'),
        vendor: card.getAttribute('data-vendor') || '',
        price: parseInt(card.getAttribute('data-price'), 10) || 0,
        image: img ? (img.currentSrc || img.src) : '',
        step: currentStep().key,
        boxId: state.boxId,
        qty: 1
      });
    }
    renderBox();
    syncCards();
    if (boxIsFull()) {
      setStatus('Box full.');
      autoAdvance('Box full — add a gift note, or skip it.');
    }
  }

  function setQty(variantId, qty, boxId) {
    var id = boxId || state.boxId;
    var item = findInBox(variantId, id);
    if (!item) return;
    if (qty > item.qty && id === state.boxId && boxIsFull()) {
      setStatus('Your box is full. Remove a can to swap it out.');
      return;
    }
    if (qty > item.qty && id !== state.boxId) {
      var count = state.box.reduce(function (n, b) { return b.boxId === id ? n + b.qty : n; }, 0);
      if (count >= boxSize(id)) return;
    }
    if (qty <= 0) {
      state.box = state.box.filter(function (b) { return !(b.variantId === variantId && b.boxId === id); });
    } else {
      item.qty = qty;
    }
    renderBox();
    syncCards();
  }

  /**
   * Keep both sets of Back/Next controls (sticky box bar + inline row under the
   * step) in the same state, and write the "what's left" hint.
   */
  function syncNav() {
    var st = currentStep();
    var isLast = state.stepIndex === CONFIG.steps.length - 1;
    var ready = stepSatisfied(state.stepIndex);
    var disabled = state.submitting || !ready;
    var label = state.submitting ? 'Adding…' : (isLast ? 'Add to cart' : 'Next');
    var atStart = state.stepIndex === 0;

    els.next.disabled = disabled;
    els.next.textContent = label;
    els.back.hidden = atStart;
    els.addBox.hidden = !(isLast && allBoxesComplete());

    if (els.nextInline) {
      els.nextInline.disabled = disabled;
      els.nextInline.innerHTML = escapeHtml(label) + (isLast ? '' : ' &rarr;');
    }
    if (els.backInline) els.backInline.hidden = atStart;

    var min = stepMin(st);
    var left = st.type === 'products' && min ? min - boxCountForStep(state.stepIndex) : 0;
    var hint = '';
    if (st.type === 'size' && !boxSize()) hint = 'Pick a box size to continue';
    else if (left > 0) hint = 'Pick ' + left + ' more can' + (left === 1 ? '' : 's') + ' to continue';
    else if (st.type === 'message') hint = 'Optional — skip it with Next';
    else if (ready && !isLast) hint = 'Ready for the next step';

    if (els.navHint) els.navHint.textContent = hint;
    if (left > 0) els.next.title = 'Pick ' + left + ' more to continue';
    else els.next.removeAttribute('title');
  }

  /**
   * Move the customer forward on their own once a step answers itself — a size
   * chosen, or the last can dropped in. Only ever once per box per step, so
   * coming Back to swap a can or change the size doesn't shove them forward
   * again mid-edit.
   */
  function autoAdvance(reason) {
    if (state.stepIndex >= CONFIG.steps.length - 1) return;
    var key = state.boxId + ':' + state.stepIndex;
    if (state.advanced[key]) return;
    if (!stepSatisfied(state.stepIndex)) return;
    state.advanced[key] = true;
    var from = state.stepIndex;
    clearTimeout(state.advanceTimer);
    state.advanceTimer = setTimeout(function () {
      if (state.stepIndex !== from || !stepSatisfied(from)) return;
      goToStep(from + 1);
      if (reason) setStatus(reason);
    }, 450);
  }

  function renderBox() {
    var items = currentBoxItems();
    var count = currentBoxCount();
    var size = boxSize();
    var total = state.box.reduce(function (n, b) { return n + b.price * b.qty; }, 0);
    var boxes = boxIdsInUse().length;

    els.boxLabel.textContent = (boxes > 1 || state.boxId > 1 ? 'Box ' + state.boxId : 'Your box') +
      (size ? ' · ' + size + ' cans' : '');

    els.boxEmpty.hidden = count > 0;
    Array.prototype.slice.call(els.box.querySelectorAll('[data-bb-boxitem]')).forEach(function (n) { n.remove(); });

    items.forEach(function (b) {
      var el = document.createElement('div');
      el.className = 'bhb-boxitem';
      el.setAttribute('data-bb-boxitem', '');
      el.innerHTML =
        (b.image ? '<img src="' + escapeHtml(b.image) + '" alt="">' : '') +
        (b.qty > 1 ? '<span class="bhb-boxitem__qty">' + b.qty + '</span>' : '') +
        '<button type="button" class="bhb-boxitem__remove" data-bb-boxremove="' + b.variantId +
        '" aria-label="Remove one ' + escapeHtml(b.title) + '">&times;</button>';
      els.box.appendChild(el);
    });

    els.boxCount.textContent = size ? (count + ' of ' + size + ' cans') : (count + (count === 1 ? ' can' : ' cans'));
    els.boxTotal.textContent = state.box.length ? money(total) : '';

    syncNav();
    renderSteps();
    if (currentStep().type === 'summary') renderSummary();
  }

  function syncCards() {
    var full = currentStep().type === 'products' && boxIsFull();
    Array.prototype.slice.call(els.mount.querySelectorAll('[data-bb-product]')).forEach(function (card) {
      var item = findInBox(card.getAttribute('data-variant-id'));
      card.classList.toggle('is-in-box', !!item);
      card.classList.toggle('is-locked', full && !item);
      var out = card.querySelector('[data-bb-qty-value]');
      if (out && item) out.textContent = item.qty;
      var plus = card.querySelector('[data-bb-qty="1"]');
      if (plus) plus.disabled = full;
      var add = card.querySelector('[data-bb-add]');
      if (add && card.getAttribute('data-available') === 'true') add.disabled = full;
    });
  }

  function boxIdsInUse() {
    var ids = Object.keys(state.sizes).map(Number);
    state.box.forEach(function (b) { if (ids.indexOf(b.boxId) === -1) ids.push(b.boxId); });
    return ids.sort(function (a, b) { return a - b; });
  }

  /** A box is complete when it has a size and holds exactly that many cans. */
  function boxIsComplete(boxId) {
    var size = boxSize(boxId);
    if (!size) return false;
    var n = state.box.reduce(function (acc, b) { return b.boxId === boxId ? acc + b.qty : acc; }, 0);
    return n === size;
  }

  function allBoxesComplete() {
    var ids = boxIdsInUse();
    return ids.length > 0 && ids.every(boxIsComplete);
  }

  function startAnotherBox() {
    if (!allBoxesComplete()) return;
    state.boxId = boxIdsInUse().reduce(function (m, id) { return Math.max(m, id); }, 0) + 1;
    goToStep(0);
    setStatus('Started box ' + state.boxId + '. Your other boxes are saved.');
  }

  function removeBox(id) {
    state.box = state.box.filter(function (b) { return b.boxId !== id; });
    delete state.sizes[id];
    var ids = boxIdsInUse();
    if (!ids.length) {
      state.boxId = 1;
      goToStep(0);
      return;
    }
    if (state.boxId === id) state.boxId = ids[ids.length - 1];
    renderBox();
    renderSummary();
  }

  // ── Cart ──────────────────────────────────────────────────────────────────
  function buildCartPayload() {
    var msg = {
      to: (els.msgTo.value || '').trim(),
      body: (els.msgBody.value || '').trim(),
      from: (els.msgFrom.value || '').trim()
    };
    var noteWritten = false;

    // Sorted so each box's cans sit together in the cart and on the order.
    var lines = state.box.slice().sort(function (a, b) { return a.boxId - b.boxId; });

    return lines.map(function (b) {
      var props = {
        'Bundle': CONFIG.bundleName,
        'Box ID': String(b.boxId),
        'Box Size': String(boxSize(b.boxId)) + ' cans'
      };
      // The note appears once per order, on the first line of box 1.
      if (!noteWritten && b.boxId === lines[0].boxId) {
        if (msg.to) props['Gift Note To'] = msg.to;
        if (msg.body) props['Gift Note'] = msg.body;
        if (msg.from) props['Gift Note From'] = msg.from;
        noteWritten = true;
      }
      return { id: Number(b.variantId), quantity: b.qty, properties: props };
    });
  }

  function submitToCart() {
    if (state.submitting) return;
    if (!allBoxesComplete()) {
      setStatus('Every box needs to be full before it can go in the cart.');
      return;
    }
    state.submitting = true;
    renderBox();
    setStatus('Adding your box to the cart…');

    fetch(ROOT_URL + 'cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: buildCartPayload() })
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (e) { throw new Error(e.description || e.message || res.status); });
        return res.json();
      })
      .then(function () {
        // Open the theme's side cart if it is there; otherwise go to /cart.
        var bag = document.querySelector('.bag');
        var drawer = document.querySelector('[data-cart-drawer]');
        state.submitting = false;
        state.box = [];
        state.sizes = {};
        state.advanced = {};
        state.boxId = 1;
        if (els.msgTo) els.msgTo.value = '';
        if (els.msgBody) els.msgBody.value = '';
        if (els.msgFrom) els.msgFrom.value = '';
        goToStep(0);
        setStatus('Added to your cart.');
        if (bag && drawer) { bag.click(); } else { window.location.href = ROOT_URL + 'cart'; }
      })
      .catch(function (err) {
        console.warn(LOG, 'cart add failed', err);
        state.submitting = false;
        renderBox();
        setStatus('Could not add your box: ' + err.message + '. Nothing was charged. Try again.');
        if (window.Sentry && window.Sentry.captureException) {
          try { window.Sentry.captureException(err); } catch (e) {}
        }
      });
  }

  // ── Quick view ────────────────────────────────────────────────────────────
  function openQuickView(card) {
    qvCard = card;
    qvReturnFocus = document.activeElement;
    var handle = card.getAttribute('data-handle');
    els.qv.hidden = false;
    root.querySelectorAll('[data-bb-qv-close]').forEach(function (n) { n.hidden = false; });
    els.qvBody.innerHTML = '<p class="bhb-qv__loading">Loading…</p>';
    els.qv.focus();

    if (qvCache[handle]) { renderQuickView(qvCache[handle]); return; }

    fetch(ROOT_URL + 'products/' + handle + '.js', { headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('product fetch ' + res.status); return res.json(); })
      .then(function (data) { qvCache[handle] = data; if (!els.qv.hidden) renderQuickView(data); })
      .catch(function (err) {
        console.warn(LOG, 'quick view failed', err);
        els.qvBody.innerHTML = '<p>Details could not be loaded. You can still add this to your box.</p>';
      });
  }

  function renderQuickView(p) {
    var main = (p.images && p.images[0]) || p.featured_image || '';
    var full = boxIsFull();
    var inBox = qvCard && findInBox(qvCard.getAttribute('data-variant-id'));
    var label = !p.available ? 'Sold out' : (full ? 'Box is full' : (inBox ? 'Add another' : 'Add to box'));
    els.qvBody.innerHTML =
      '<div class="bhb-qv__media">' + (main ? '<img src="' + escapeHtml(main) + '" alt="' + escapeHtml(p.title) + '">' : '') + '</div>' +
      '<div class="bhb-qv__info">' +
        '<p class="eyebrow eyebrow--clay">' + escapeHtml(p.vendor) + '</p>' +
        '<h3 id="bhb-qv-title">' + escapeHtml((qvCard && qvCard.getAttribute('data-title')) || p.title) + '</h3>' +
        '<p class="price">' + money(p.price) + '</p>' +
        '<div class="bhb-qv__desc">' + (p.description || '') + '</div>' +
        '<button type="button" class="cta cta--block" data-bb-qv-add' + (p.available && !full ? '' : ' disabled') + '>' + label + '</button>' +
      '</div>';
  }

  function closeQuickView() {
    els.qv.hidden = true;
    root.querySelectorAll('[data-bb-qv-close]').forEach(function (n) { n.hidden = true; });
    els.qvBody.innerHTML = '';
    qvCard = null;
    if (qvReturnFocus && qvReturnFocus.focus) qvReturnFocus.focus();
    qvReturnFocus = null;
  }

  // ── Review ────────────────────────────────────────────────────────────────
  function renderSummary() {
    var ids = boxIdsInUse();
    if (!state.box.length) {
      els.summary.innerHTML = '<p class="bhb-summary__empty">Your box is empty. Go back and pick some beers.</p>';
      return;
    }

    var html = ids.map(function (id) {
      var items = state.box.filter(function (b) { return b.boxId === id; });
      var count = items.reduce(function (n, b) { return n + b.qty; }, 0);
      var size = boxSize(id);
      var sub = items.reduce(function (n, b) { return n + b.price * b.qty; }, 0);
      var complete = boxIsComplete(id);

      var rows = items.map(function (b) {
        return '<div class="bhb-sumitem">' +
          '<span class="bhb-sumitem__media">' + (b.image ? '<img src="' + escapeHtml(b.image) + '" alt="">' : '') + '</span>' +
          '<span class="bhb-sumitem__name"><small>' + escapeHtml(b.vendor) + '</small>' + escapeHtml(b.title) + '</span>' +
          '<span class="qty">' +
            '<button type="button" data-bb-sumqty="-1" data-variant="' + b.variantId + '" data-box="' + id + '" aria-label="Remove one">&minus;</button>' +
            '<output>' + b.qty + '</output>' +
            '<button type="button" data-bb-sumqty="1" data-variant="' + b.variantId + '" data-box="' + id + '" aria-label="Add one"' + (count >= size ? ' disabled' : '') + '>+</button>' +
          '</span>' +
          '<span class="bhb-sumitem__price">' + money(b.price * b.qty) + '</span>' +
        '</div>';
      }).join('');

      return '<section class="bhb-sumbox">' +
        '<div class="bhb-sumbox__head">' +
          '<h3>' + (ids.length > 1 ? 'Box ' + id : 'Your box') + '</h3>' +
          '<span class="bhb-sumbox__count' + (complete ? '' : ' is-short') + '">' + count + ' of ' + size + ' cans</span>' +
          '<button type="button" class="bhb-link" data-bb-sumedit="beers" data-box="' + id + '">Edit</button>' +
          (ids.length > 1 ? '<button type="button" class="bhb-link" data-bb-sumboxremove="' + id + '">Remove box</button>' : '') +
        '</div>' + rows +
        '<div class="bhb-sumbox__sub"><span>Box subtotal</span><span>' + money(sub) + '</span></div>' +
      '</section>';
    }).join('');

    var to = (els.msgTo.value || '').trim();
    var body = (els.msgBody.value || '').trim();
    var from = (els.msgFrom.value || '').trim();
    if (to || body || from) {
      html += '<section class="bhb-sumbox">' +
        '<div class="bhb-sumbox__head"><h3>Gift note</h3>' +
        '<button type="button" class="bhb-link" data-bb-sumedit="message">Edit</button></div>' +
        '<div class="bhb-summessage">' +
          (to ? '<strong>To ' + escapeHtml(to) + '</strong>' : '') +
          (body ? '<p>' + escapeHtml(body) + '</p>' : '') +
          (from ? '<p>— ' + escapeHtml(from) + '</p>' : '') +
        '</div></section>';
    }

    var subtotal = state.box.reduce(function (n, b) { return n + b.price * b.qty; }, 0);
    html += '<div class="bhb-sumtotals">' +
      '<div class="bhb-sumtotals__row bhb-sumtotals__total"><span>Subtotal</span><span>' + money(subtotal) + '</span></div>' +
      '<p class="bhb-field__hint">Shipping and taxes calculated at checkout.' +
      (CONFIG.signatureNotice ? ' ' + escapeHtml(CONFIG.signatureNotice) + '.' : '') + '</p>' +
      '</div>';

    els.summary.innerHTML = html;
  }

  function stepIndexOf(key) {
    for (var i = 0; i < CONFIG.steps.length; i++) if (CONFIG.steps[i].key === key) return i;
    return 0;
  }

  /** Put the step rail back in view; a step change lower down is easy to miss. */
  function scrollToSteps() {
    if (!els.steps || typeof els.steps.getBoundingClientRect !== 'function') return;
    var top = els.steps.getBoundingClientRect().top;
    if (top >= 0 && top < 160) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      els.steps.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    } catch (e) {
      els.steps.scrollIntoView();
    }
  }

  function goToStep(index) {
    if (index < 0 || index >= CONFIG.steps.length) return;
    var moved = index !== state.stepIndex;
    state.stepIndex = index;
    state.filters = [];
    state.query = '';
    if (els.search) els.search.value = '';
    openDrawer(false);

    var type = currentStep().type;
    var isProducts = type === 'products';

    els.sizes.hidden = type !== 'size';
    els.message.hidden = type !== 'message';
    els.summary.hidden = type !== 'summary';
    els.mount.hidden = !isProducts;
    els.loadMore.parentNode.hidden = !isProducts;
    els.toolbar.hidden = !isProducts;

    renderSteps();
    renderFilters();
    renderBox();
    if (moved) scrollToSteps();

    if (type === 'size') {
      renderSizes();
      reset();
      setStatus(state.boxId > 1 ? 'Box ' + state.boxId + ': pick a size.' : '');
      return;
    }
    if (type === 'message') { reset(); setStatus('Optional. Leave it blank to skip.'); return; }
    if (type === 'summary') { reset(); setStatus(''); renderSummary(); return; }

    var left = stepMin(currentStep()) - boxCountForStep(state.stepIndex);
    navigate().then(function () {
      if (left > 0 && state.token) setStatus(els.status.textContent + ' · pick ' + left + ' more');
    });
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  els.filtersOpen.addEventListener('click', function () { openDrawer(true); });
  root.addEventListener('click', function (e) {
    if (e.target.closest('[data-bb-filters-close]')) openDrawer(false);
    if (e.target.closest('[data-bb-qv-close]')) closeQuickView();
  });
  els.filterGroups.addEventListener('click', function (e) {
    var head = e.target.closest('[data-bb-fgroup-toggle]');
    if (head) head.parentNode.classList.toggle('is-open');
  });
  els.filterGroups.addEventListener('change', function (e) {
    var cb = e.target.closest('[data-bb-filter]');
    if (cb) toggleFilter(cb.getAttribute('data-bb-filter'), cb.checked);
  });
  root.querySelector('[data-bb-filters-clear]').addEventListener('click', clearFilters);

  els.steps.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-bb-step]');
    if (!btn || btn.disabled) return;
    goToStep(stepIndexOf(btn.getAttribute('data-bb-step')));
  });

  els.sizeOptions.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-bb-size]');
    if (!btn) return;
    setSize(Number(btn.getAttribute('data-bb-size')));
  });

  var searchTimer = null;
  els.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var value = els.search.value.trim();
    searchTimer = setTimeout(function () { state.query = value; navigate(); }, SEARCH_DEBOUNCE_MS);
  });

  els.loadMore.addEventListener('click', function () { loadMore(); });

  els.mount.addEventListener('click', function (e) {
    var card = e.target.closest('[data-bb-product]');
    if (!card) return;
    if (e.target.closest('[data-bb-view]')) { openQuickView(card); return; }
    if (e.target.closest('[data-bb-add]')) { addToBox(card); return; }
    var step = e.target.closest('[data-bb-qty]');
    if (step) {
      var id = card.getAttribute('data-variant-id');
      var item = findInBox(id);
      setQty(id, (item ? item.qty : 0) + parseInt(step.getAttribute('data-bb-qty'), 10));
    }
  });

  els.summary.addEventListener('click', function (e) {
    var edit = e.target.closest('[data-bb-sumedit]');
    if (edit) {
      var boxAttr = edit.getAttribute('data-box');
      if (boxAttr) state.boxId = Number(boxAttr);
      goToStep(stepIndexOf(edit.getAttribute('data-bb-sumedit')));
      return;
    }
    var q = e.target.closest('[data-bb-sumqty]');
    if (q) {
      var boxId = Number(q.getAttribute('data-box'));
      var vid = q.getAttribute('data-variant');
      var item = findInBox(vid, boxId);
      setQty(vid, (item ? item.qty : 0) + parseInt(q.getAttribute('data-bb-sumqty'), 10), boxId);
      renderSummary();
      return;
    }
    var rm = e.target.closest('[data-bb-sumboxremove]');
    if (rm) removeBox(Number(rm.getAttribute('data-bb-sumboxremove')));
  });

  els.box.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-bb-boxremove]');
    if (!rm) return;
    var id = rm.getAttribute('data-bb-boxremove');
    var item = findInBox(id);
    if (item) setQty(id, item.qty - 1);
  });

  els.qvBody.addEventListener('click', function (e) {
    if (e.target.closest('[data-bb-qv-add]') && qvCard) {
      addToBox(qvCard);
      closeQuickView();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!els.qv.hidden) closeQuickView();
    else if (!els.drawer.hidden) openDrawer(false);
  });

  function goNext() {
    clearTimeout(state.advanceTimer);
    if (!stepSatisfied(state.stepIndex)) return;
    state.advanced[state.boxId + ':' + state.stepIndex] = true;
    if (state.stepIndex < CONFIG.steps.length - 1) goToStep(state.stepIndex + 1);
    else submitToCart();
  }
  function goBack() {
    clearTimeout(state.advanceTimer);
    if (state.stepIndex > 0) goToStep(state.stepIndex - 1);
  }
  els.next.addEventListener('click', goNext);
  els.back.addEventListener('click', goBack);
  if (els.nextInline) els.nextInline.addEventListener('click', goNext);
  if (els.backInline) els.backInline.addEventListener('click', goBack);
  els.addBox.addEventListener('click', startAnotherBox);

  els.msgBody.addEventListener('input', function () {
    els.msgRemaining.textContent = String(400 - els.msgBody.value.length);
  });

  window.__bhBuilder = {
    state: function () { return JSON.parse(JSON.stringify(state)); },
    config: function () { return CONFIG; },
    url: buildUrl,
    goToStep: goToStep,
    setSize: setSize,
    payload: buildCartPayload
  };

  goToStep(0);
})();
