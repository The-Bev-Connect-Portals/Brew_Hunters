# Brew Hunters — theme

Shopify storefront for Brew Hunters: the front-facing e-commerce site for Go-To Gifting's
craft beer brand partners (Topa Topa, Mother Earth, Figueroa Mountain, Rincon Brewery) and
the backend for each brand's headless portal.

## Branches

| Branch | Contents |
| --- | --- |
| `main` | Reserved for the live Shopify theme (Online Store 2.0 file layout at repo root). |
| `design/prototype-v1` | Design prototypes only. No theme code. Not connected to Shopify. |

Keeping prototypes off `main` means the Shopify GitHub integration can be pointed at `main`
without picking up anything that isn't theme code.

## design/brew-hunters-prototype.html

A single self-contained HTML page — open it in a browser, no build step. It exists to settle
the visual direction before any Liquid gets written.

Reference sites: [drinkloverboy.com](https://drinkloverboy.com) and
[popsmith.com](https://popsmith.com). Neither is an off-the-shelf theme; both are a bare
2.0 starter theme plus a licensed display font, a per-section color-token system, and roughly
ten custom sections. This prototype reproduces that construction for Brew Hunters.

Product names, prices, pack sizes and imagery are pulled live from the Brew Hunters store.

### Views

- **Home** — marquee promo bar, split hero with arc-text sticker, layered SVG wave dividers,
  value props, brewery tiles, product grid, build-a-box banner, review block, footer.
- **Product** — gallery with CSS zoom states, pack-size selector (real multi-variant data on
  the Figueroa Mountain SKUs), one-time vs. subscribe pricing, tasting notes and shipping
  accordions, related products. Click any product card to open it.
- **Build a box** — working twelve-can picker with a fill tray, quick-fill presets and a flat
  box rate.

### Design tokens

| Token | Value | Use |
| --- | --- | --- |
| `--spruce` | `#16241E` | Dark sections, borders, body text |
| `--fog` | `#EDE3CE` | Primary light ground |
| `--paper` | `#FBF6EA` | Card and secondary ground |
| `--ember` | `#F2551F` | Primary CTA, accent blocks |
| `--gold` | `#F2B33D` | Hero panel, secondary CTA, stickers |
| `--surf` | `#186B68` | Tertiary block |
| `--clay` | `#9E3B24` | Eyebrows, wave underlayer |

Type: Bricolage Grotesque 800 (display) / Hanken Grotesk (body) / DM Mono (specs and labels).
All three are free via Google Fonts — no font license required to ship this direction.

## Sections to build in Liquid

- `promo-marquee`
- `split-hero` (+ arc sticker snippet)
- `wave-divider` (color-pair schema setting)
- `value-props`
- `brewery-tiles`
- `featured-products`
- `main-product` (gallery, pack selector, selling plan, accordions)
- `build-a-box` (cart line-item properties)
- `review-block`
- `footer`

## Compliance notes

Every purchase path assumes an adult signature at delivery and ZIP-level shipping eligibility
at checkout. Any state-coverage claim in the UI is placeholder copy until the shipping map is
confirmed per brand.
