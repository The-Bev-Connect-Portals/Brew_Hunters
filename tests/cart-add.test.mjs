// Cart regression tests — audit FIX-02 / FIX-08 (2026-10-07).
// Loads the theme's real JS asset into a minimal page and mocks Shopify's cart API.
// Run: node tests/cart-add.test.mjs   (needs `playwright` + chromium)
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const JS = readFileSync(new URL('../assets/brew-hunters.js', import.meta.url), 'utf8');
const PAGE = `<!doctype html><html><body>
<a class="bag" href="/cart"><span data-cart-count>0</span></a><div data-scrim hidden></div>
<aside data-cart-drawer data-open="false"><button data-cart-close>x</button><div data-cart-body></div><div data-cart-foot hidden><span data-cart-subtotal></span></div></aside>
<form id="product-form" action="/cart/add" method="post"><input type="hidden" name="id" value="1"><textarea data-gift-message></textarea><button type="submit" data-pdp-add>Add to cart</button></form>
<script src="/theme.js"></script></body></html>`;
const EVIL = { item_count: 1, total_price: 1399, items: [{ product_title: '<img src=x onerror="window.PWN=1">Ale & "Co"',
  variant_title: '<b>v</b>', quantity: 1, final_line_price: 1399, image: null,
  properties: { Cans: '<img src=x onerror="window.PWN=2">', 'Gift message': '<i>hi</i>', 'Box ID': '<u>7</u>' },
  selling_plan_allocation: { selling_plan: { name: '<em>Monthly</em>' } } }] };

async function run(mode) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const adds = []; let cartNav = 0;
  await page.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.endsWith('/cart/add')) {
      adds.push(r.request().resourceType());
      if (r.request().resourceType() === 'document') return r.fulfill({ status: 200, body: 'native repost' });
      if (mode === 'net') return r.abort();
      if (mode === 'reject') return r.fulfill({ status: 422, contentType: 'application/json', body: '{"description":"Sold out"}' });
      await new Promise((x) => setTimeout(x, 300));
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":1}' });
    }
    if (u.endsWith('/cart.js')) {
      if (mode === 'readfail') return r.fulfill({ status: 500, body: 'oops' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EVIL) });
    }
    if (u.endsWith('/cart')) { cartNav++; return r.fulfill({ status: 200, body: 'cart' }); }
    if (u.endsWith('/theme.js')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: JS });
    return r.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
  });
  await page.goto('https://store.test/');
  if (mode === 'dbl') {
    await page.evaluate(() => { const b = document.querySelector('[data-pdp-add]'); b.click(); b.click(); document.querySelector('#product-form').requestSubmit(); });
  } else {
    await page.click('[data-pdp-add]');
  }
  await page.waitForTimeout(1500);
  let st = {};
  try {
    st = await page.evaluate(() => ({
      err: (document.querySelector('[data-add-error]') || {}).textContent || '',
      pwn: window.PWN || 0,
      injected: document.querySelector('[data-cart-body]').querySelectorAll('img,b b,i,u,em').length
    }));
  } catch { st = { navigated: true }; }
  await browser.close();
  return { adds, cartNav, ...st };
}

const cases = {
  ok:       (r) => r.adds.length === 1 && r.pwn === 0 && r.injected === 0,
  readfail: (r) => r.adds.length === 1 && !r.adds.includes('document') && r.cartNav === 1,
  dbl:      (r) => r.adds.length === 1,
  reject:   (r) => r.adds.length === 1 && /Sold out/.test(r.err),
  net:      (r) => r.adds.length === 1 && !r.adds.includes('document') && r.err.length > 0,
};
let failed = 0;
for (const [name, ok] of Object.entries(cases)) {
  const r = await run(name);
  const pass = ok(r);
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} ${JSON.stringify(r)}`);
}
process.exit(failed ? 1 : 0);
