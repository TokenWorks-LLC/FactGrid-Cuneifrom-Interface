# Design system

## Direction

The interface is a quiet digital conservation bench: warm paper, mineral ink,
hairline rules, catalogue labels, and generous reading space. It should feel like
a careful scholarly instrument rather than an institutional dashboard. Decoration
must communicate record structure, provenance, or state.

The product name is always **FactGrid Cuneiform Interface**. FactGrid is named as
the authority; the interface never suggests a CDLI affiliation or invents
institutional branding.

## Foundations

- **Heading face:** Source Serif 4. Use medium or semibold weights and tight,
  restrained tracking for titles.
- **Interface face:** IBM Plex Sans. Body copy is normally 16–17px with open line
  height; labels never fall below 12px.
- **Transcript face:** IBM Plex Mono with Noto Sans Cuneiform as the glyph fallback.
- **Background:** warm archival paper, `oklch(0.968 0.012 82)`.
- **Foreground:** mineral brown-black, `oklch(0.22 0.012 70)`.
- **Primary:** restrained fired-clay brown, `oklch(0.45 0.11 38)`.
- **Borders:** visible hairlines, `oklch(0.79 0.025 72)`. Borders express grouping;
  avoid stacked generic cards and ornamental rounding.
- **Shape:** near-square corners with a 0.15rem base radius.
- **Measure:** prose is limited to roughly 72 characters. The main canvas tops out
  at 78rem with a 1rem mobile gutter.

The color tokens in `src/app/globals.css` are the implementation source of truth.
New states should reuse semantic tokens instead of introducing literal colors.

## Hierarchy and layout

Use small uppercase monospaced eyebrow labels above clear serif headings. Keep one
primary heading per page. Secondary information is separated with whitespace and
rules rather than elevated panels.

Record pages use a metadata rail beside the text at desktop widths. At narrow
widths, text and edition tools come first and metadata follows. Multi-edition
records provide a linked index and an explicit comparison surface; only the first
full edition opens initially so the page remains scannable.

The header remains compact and sticky. Its current section is both visually
underlined and exposed with `aria-current="page"`. The dark footer closes the page
and carries only authority and source links.

## Components and states

- Buttons and interactive controls have a minimum 44px target and a visible
  two-pixel focus outline.
- Search and filter state is URL-driven. Filter choices are explicitly described
  as contextual to the current result page; selected values apply to the full
  catalogue query before pagination.
- Every edition states `Editable`, `Read only`, or `Missing` beside its name. Put a
  read-only reason before the transcript, not after it.
- Missing data is explicit prose, never an empty frame or invented placeholder.
- Loading uses reserved structural space. Errors preserve the user’s context and,
  for a tablet, offer the authoritative QID record plus a catalogue route.
- External links are labelled as sources and use a small external-link icon where
  space permits. Icons support text; they do not replace essential labels.
- Images appear only with verified provenance. Record image claims without
  item-specific reuse rights remain links.

## Transcript presentation

Preserve line breaks, whitespace, diacritics, and cuneiform glyphs. Transcript
surfaces use `white-space: pre-wrap`, safe wrapping, and a compact monospace line
height. Never render source wikitext as HTML. Comparison panes share a fixed visual
height and synchronize relative scroll position; on mobile they stack in source
order.

Editing is subordinate to reading. It appears only for a server-verified supported
target. The source context and base revision remain visible, destructive ambiguity
is stated plainly, and save/cancel controls retain keyboard focus and touch sizing.

## Accessibility

Maintain semantic landmarks, a skip link, hierarchical headings, native labels,
keyboard-operable disclosure controls, visible focus, and sufficient contrast.
Honor `prefers-reduced-motion`; scrolling enhancements must not be required to use
the page. Status must never be communicated by color alone. Long QIDs, document
titles, Unicode, and scholarly notation must wrap without hiding content.

## Content voice

Write concise, source-conscious sentences. Distinguish `missing`, `unsupported`,
`read only`, `upstream unavailable`, and `not authorized`; these are different
states. Avoid promotional claims, faux statistics, and generic calls to action.
Prefer concrete verbs such as **Browse tablets**, **Compare editions**, and
**Open authoritative record**.
