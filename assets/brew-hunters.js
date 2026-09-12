/* ==========================================================================
   Brew Hunters — theme JS
   No framework, no build step. Everything is progressive: the page works
   with JS off, this only upgrades it.
   ========================================================================== */
(function () {
  'use strict';

  var money = function (cents) {
    return '$' + (cents / 100).toFixed(2);
  };

  /* ---------------- mobile nav ---------------- */
  var navToggle = document.querySelector('[data-nav-toggle]');
  var navDrawer = document.getElementById('nav-drawer');
  if (navToggle && navDrawer) {
    navToggle.addEventListener('click', function () {
      var open = navDrawer.hasAttribute('open');
      if (open) {
        navDrawer.removeAttribute('open');
      } else {
        navDrawer.setAttribute('open', '');
      }
      navToggle.setAttribute('aria-expanded', String(!open));
    });
  }

  /* ---------------- cart count ---------------- */
  function refreshCartCount() {
    fetch(window.Shopify && window.Shopify.routes ? window.Shopify.routes.root + 'cart.js' : '/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        document.querySelectorAll('[data-cart-count]').forEach(function (el) {
          el.textContent = cart.item_count;
        });
      })
      .catch(function () { /* count stays as rendered */ });
  }

  /* ---------------- quick add from product cards ---------------- */
  document.querySelectorAll('form[data-quick-add]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button');
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

      fetch(form.action, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new FormData(form)
      })
        .then(function (r) { return r.json(); })
        .then(function () {
          if (btn) { btn.textContent = 'Added'; }
          refreshCartCount();
          setTimeout(function () {
            if (btn) { btn.disabled = false; btn.textContent = label; }
          }, 1400);
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = label; }
          form.submit();
        });
    });
  });

  /* ---------------- product gallery ---------------- */
  var thumbs = document.querySelector('[data-pdp-thumbs]');
  var mainImg = document.querySelector('[data-pdp-img]');
  if (thumbs && mainImg) {
    thumbs.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      mainImg.src = btn.getAttribute('data-full');
      thumbs.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-current', String(b === btn));
      });
    });
  }

  /* ---------------- variant / pack selector ---------------- */
  var pdp = document.querySelector('[data-product]');
  if (pdp) {
    var variants = [];
    try {
      variants = JSON.parse(pdp.getAttribute('data-variants') || '[]');
    } catch (err) {
      variants = [];
    }

    var optionRows = Array.prototype.slice.call(pdp.querySelectorAll('[data-option-index]'));
    var variantInput = pdp.querySelector('[data-variant-input]');
    var priceEl = pdp.querySelector('[data-pdp-price]');
    var compareEl = pdp.querySelector('[data-pdp-compare]');
    var addBtn = pdp.querySelector('[data-pdp-add]');

    function currentSelection() {
      return optionRows.map(function (row) {
        var on = row.querySelector('[aria-pressed="true"]');
        return on ? on.getAttribute('data-option-value') : null;
      });
    }

    function matchVariant(selection) {
      return variants.find(function (v) {
        return selection.every(function (val, i) {
          return val === null || v.options[i] === val;
        });
      });
    }

    function markAvailability(selection) {
      optionRows.forEach(function (row, rowIndex) {
        row.querySelectorAll('.pack').forEach(function (btn) {
          var trial = selection.slice();
          trial[rowIndex] = btn.getAttribute('data-option-value');
          var match = variants.find(function (v) {
            return trial.every(function (val, i) {
              return val === null || v.options[i] === val;
            });
          });
          btn.setAttribute('data-available', String(!!(match && match.available)));
        });
      });
    }

    function syncVariant() {
      var selection = currentSelection();
      var variant = matchVariant(selection);
      markAvailability(selection);

      if (!variant) {
        if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Unavailable'; }
        return;
      }

      if (variantInput) variantInput.value = variant.id;
      if (priceEl) priceEl.textContent = money(variant.price);

      if (compareEl) {
        if (variant.compare_at_price && variant.compare_at_price > variant.price) {
          compareEl.textContent = money(variant.compare_at_price);
          compareEl.hidden = false;
        } else {
          compareEl.hidden = true;
        }
      }

      if (addBtn) {
        addBtn.disabled = !variant.available;
        addBtn.textContent = variant.available ? 'Add to cart' : 'Sold out';
      }

      // keep the URL shareable without a reload
      var url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url);
    }

    optionRows.forEach(function (row) {
      row.addEventListener('click', function (e) {
        var btn = e.target.closest('.pack');
        if (!btn) return;
        row.querySelectorAll('.pack').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        syncVariant();
      });
    });

    if (optionRows.length) syncVariant();
  }

  /* ---------------- build a box ---------------- */
  var box = document.querySelector('[data-box]');
  if (box) {
    var capacity = parseInt(box.getAttribute('data-capacity'), 10) || 12;
    var picks = Array.prototype.slice.call(box.querySelectorAll('[data-pick]'));
    var trayEl = box.querySelector('[data-tray]');
    var meterEl = box.querySelector('[data-meter]');
    var countEl = box.querySelector('[data-count]');
    var addBtn = box.querySelector('[data-box-add]');
    var propsEl = box.querySelector('[data-box-props]');
    var counts = {};

    function total() {
      return Object.keys(counts).reduce(function (sum, k) { return sum + counts[k]; }, 0);
    }

    function render() {
      var n = total();

      // qty outputs
      picks.forEach(function (pick) {
        var id = pick.getAttribute('data-id');
        pick.querySelector('[data-qty]').textContent = counts[id] || 0;
      });

      // tray slots
      var slots = trayEl.querySelectorAll('[data-slot]');
      var filled = [];
      picks.forEach(function (pick) {
        var id = pick.getAttribute('data-id');
        for (var i = 0; i < (counts[id] || 0); i++) {
          filled.push(pick.getAttribute('data-img'));
        }
      });
      slots.forEach(function (slot, i) {
        if (filled[i]) {
          slot.classList.add('slot--full');
          slot.innerHTML = '<img src="' + filled[i] + '" alt="">';
        } else {
          slot.classList.remove('slot--full');
          slot.innerHTML = '';
        }
      });

      if (meterEl) meterEl.style.width = Math.min(100, (n / capacity) * 100) + '%';
      if (countEl) countEl.textContent = n;

      if (addBtn) {
        var done = n === capacity;
        addBtn.disabled = !done;
        addBtn.textContent = done ? 'Add box to cart' : 'Pick ' + capacity + ' to continue';
      }

      // write the selection into cart line-item properties
      if (propsEl) {
        var lines = [];
        picks.forEach(function (pick) {
          var id = pick.getAttribute('data-id');
          if (counts[id]) {
            lines.push(counts[id] + '× ' + pick.getAttribute('data-title'));
          }
        });
        propsEl.innerHTML = '';
        lines.forEach(function (line, i) {
          var input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'properties[Can ' + (i + 1) + ']';
          input.value = line;
          propsEl.appendChild(input);
        });
        var summary = document.createElement('input');
        summary.type = 'hidden';
        summary.name = 'properties[Cans]';
        summary.value = lines.join(', ');
        propsEl.appendChild(summary);
      }
    }

    function bump(id, step) {
      var n = total();
      var next = (counts[id] || 0) + step;
      if (next < 0) return;
      if (step > 0 && n >= capacity) return;
      counts[id] = next;
      if (!counts[id]) delete counts[id];
      render();
    }

    box.addEventListener('click', function (e) {
      var stepBtn = e.target.closest('[data-step]');
      if (stepBtn) {
        var pick = stepBtn.closest('[data-pick]');
        bump(pick.getAttribute('data-id'), parseInt(stepBtn.getAttribute('data-step'), 10));
        return;
      }

      var presetBtn = e.target.closest('[data-preset]');
      if (presetBtn) {
        var tag = presetBtn.getAttribute('data-preset');
        counts = {};

        if (tag !== '__clear') {
          var pool;
          if (tag === '__tour') {
            // one from each brewery, round-robin
            var byVendor = {};
            picks.forEach(function (p) {
              var vend = p.getAttribute('data-vendor');
              if (!byVendor[vend]) byVendor[vend] = [];
              byVendor[vend].push(p);
            });
            pool = [];
            var vendors = Object.keys(byVendor);
            var depth = 0;
            while (pool.length < capacity && depth < 20) {
              vendors.forEach(function (vend) {
                if (byVendor[vend][depth] && pool.length < capacity) {
                  pool.push(byVendor[vend][depth]);
                }
              });
              depth++;
            }
          } else {
            pool = picks.filter(function (p) {
              return (p.getAttribute('data-tags') || '')
                .split(',')
                .map(function (t) { return t.trim().toLowerCase(); })
                .indexOf(tag.toLowerCase()) !== -1;
            });
          }

          if (pool.length) {
            for (var i = 0; i < capacity; i++) {
              var id = pool[i % pool.length].getAttribute('data-id');
              counts[id] = (counts[id] || 0) + 1;
            }
          }
        }
        render();
      }
    });

    var boxForm = box.querySelector('[data-box-form]');
    if (boxForm) {
      boxForm.addEventListener('submit', function (e) {
        if (total() !== capacity) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        fetch(boxForm.action, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: new FormData(boxForm)
        })
          .then(function (r) { return r.json(); })
          .then(function () {
            window.location.href = box.getAttribute('data-cart-url');
          })
          .catch(function () { boxForm.submit(); });
      });
    }

    render();
  }

  /* ---------------- entrance animation ---------------- */
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.armed').forEach(function (el) { io.observe(el); });
  }
})();
