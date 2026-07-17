# Nirvana Telemetry design specification

Reference: `nirvana-telemetry-concept.png`

The product is a contemplative research console, not a marketing page. At desktop widths it uses a 68px header and three open, divider-separated regions: a 272px experiment rail, a flexible conversation workspace, and a 336px telemetry rail. Tablet collapses the experiment rail into a sheet; mobile collapses both rails into sheets while keeping the composer reachable above the safe area.

## Tokens

- Mineral paper `#f3f0e7`; ink `#171914`; muted ink `#66675f`
- Moss `#52634a`; saffron `#c48837`; vermilion `#b4533e`
- Hairline `rgba(23, 25, 20, .18)`; restrained radius `10px`
- Humanist system sans for UI, Georgia-style serif for model answers, tabular mono digits for telemetry
- Motion: 180–280ms state transitions; disabled under `prefers-reduced-motion`

## Component families

- Header actions: one quiet outlined action, one moss primary action
- Rails: open sections separated by hairlines; cards only for editable fields
- Mode control: semantic radio group with a strong selected ring
- Metrics: label, desired direction, tabular value, progress track, and tiny trace
- Conversation: unboxed transcript, serif assistant answer, sticky composer
- Composite: one geometric wheel/halo is the sole spiritual motif

## Allowed first-viewport copy

`NIRVANA TELEMETRY`, `Behavioral observability for measured minds.`, `The instrument is quiet.`, `Export JSON`, `New session`, `Experiment`, `Conversation`, `WHO UPDATES THE STATE?`, `Self reflection`, `External judge`, `Feed state into next turn`, `Objective`, `Injected prompt`, the five metric labels, `Turn history`, `Evidence notes`, and the composer placeholder from the concept.

The composite and all metrics are explicitly framed as behavioral heuristics, never evidence of correctness or hidden mental state.
