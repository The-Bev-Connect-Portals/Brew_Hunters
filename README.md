# Brew Hunters — Shopify theme

Online Store 2.0 theme for Brew Hunters: the front-facing e-commerce site for
Go-To Gifting's craft beer brand partners (Topa Topa, Mother Earth, Figueroa
Mountain, Rincon Brewery) and the backend for each brand's headless portal.

Built from `design/prototype-v1`. No framework, no build step — the theme is
plain Liquid, CSS and vanilla JS, the same construction as drinkloverboy.com
and popsmith.com.

## Branches

| Branch | Contents |
| --- | --- |
| `main` | This theme. Connected to Shopify via the GitHub integration. |
| `design/prototype-v1` | The original design prototype. Not theme code, not connected. |

## File layout

```
assets/       base.css, brew-hunters.js
config/       settings_schema.json, settings_data.json
layout/       theme.liquid
locales/      en.default.json
sections/     10 custom sections + main-* templates + header/footer groups
snippets/     product-card, arc-sticker, icon-sprite, meta-tags
templates/    index, product, collection, cart, page, page.build-a-box, search, 404, list-collections
```

## The colour system

Every section carries a `color_scheme` select that resolves to a `--bg`/`--fg`
pair on the section wrapper via `.scheme--*` in `base.css`. Sections never
hard-code a background. Adding a palette entry means adding one `.scheme--x`
rule, not touching any section.

| Token | Hex | Use |
| --- | --- | --- |
| `--spruce` | `#16241E` | Dark sections, borders, body text |
| `--fog` | `#EDE3CE` | Primary light ground |
| `--paper` | `#FBF6EA` | Card and secondary ground |
| `--ember` | `#F2551F` | Primary CTA, accent blocks |
| `--gold` | `#F2B33D` | Hero panel, secondary CTA, stickers |
| `--surf` | `#186B68` | Tertiary block |
| `--clay` | `#9E3B24` | Eyebrows, wave underlayer |

Type: Bricolage Grotesque 800 (display) / Hanken Grotesk (body) / DM Mono
(specs and labels). All three free via Google Fonts — no licence needed.

`wave-divider` takes three colour selects. **The front layer must match the
`color_scheme` of the section directly below it** or you get a visible seam.

## Sections

| Section | Notes |
| --- | --- |
| `promo-marquee` | Blocks are messages; the track is duplicated for a seamless loop. |
| `header` | Sticky, uses `main-menu` by default. |
| `split-hero` | Three heading lines; line 2 renders outlined. Optional arc sticker. |
| `wave-divider` | Two shapes, three colour layers. |
| `value-props` | Up to 4 blocks, 4 icon choices. |
| `brewery-tiles` | Each tile points at a collection; count label auto-fills from `products_count`. |
| `featured-products` | Falls back to placeholder cards when no collection is set. |
| `build-a-box-banner` | Homepage promo for the builder. |
| `main-product` | Gallery, variant pack selector, selling plans, metafield-backed accordions. |
| `build-a-box` | The 12-can picker. See below. |
| `review-block` | Ships in placeholder mode — see compliance. |
| `footer` | Text / menu / newsletter blocks. |

## Product metafields

Optional, all in the `specs` namespace. Absent metafields just render nothing.

| Key | Used by |
| --- | --- |
| `specs.abv` | Card and PDP spec pills |
| `specs.pack` | Card spec pills |
| `specs.size` | PDP spec pills |
| `specs.tasting_notes` | PDP "Tasting notes" accordion |

Card flags come from product tags: `flagship` and `fan-favorite`.

## Build a box

The box is **one Shopify product** (set `box_product` in the theme editor) sold
at a flat rate. The twelve chosen cans ride along as cart line-item properties:
`Can 1` … `Can n` plus a combined `Cans` summary line.

Consequence to plan around: **the box product decrements inventory, the
individual cans do not.** If you need per-can stock movement, that has to be
reconciled outside the storefront.

Quick-fill presets match a product tag. Two reserved values:
`__tour` (round-robins one per brewery) and `__clear`.

## Working on this theme

The Shopify GitHub integration syncs `main`. Three things to know:

1. `config/settings_data.json` is owned by Shopify and gets force-pushed back
   on every theme-editor save. Don't hand-edit it and expect it to survive.
2. `url`-type settings cannot carry default values — the section and any
   template referencing it get silently rejected.
3. Always `git pull --rebase origin main` before pushing; the sync pushes
   "Update from Shopify" commits continuously.

## Compliance

Shipping eligibility and age verification are enforced **at Shopify checkout**,
never on the storefront. Copy in the hero, footer and PDP accordions is display
only and must never be read as the enforcement layer. Do not name specific
states anywhere in the UI until the attorney-confirmed list exists.

The `review-block` ships with its placeholder badge on. Leave it on until real
reviews are wired in from a review app — do not publish invented reviews as
real customer quotes.
