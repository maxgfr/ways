# Design

ways looks like what it is: a map app in the standard of its genre. White rounded panels float over the map, one blue marks what can be acted on and draws the route. The finish it is measured against is Google Maps; its name, icon, wording and artwork are its own.

## Principles

- **The map is the product.** Panels cover as little of it as the task needs. On a phone the panel is a bottom sheet with three heights; on a wide screen it is a 400 px column on the left.
- **Shape before colour.** A way of travelling is a stroke: solid for a ride, dashed by bike, dotted on foot. The same stroke is drawn on the map and beside the leg in the list. A selected chip shows a check, an empty bike station is hollow, a cancelled departure is struck through. Colour repeats what the shape already says.
- **Operator colours are theirs.** A line's badge uses the colour its operator publishes, with black or white text chosen for contrast, and always shows the line's name.
- **Say where it comes from.** Every list that came from a service ends with a line naming it.
- **Live or scheduled, never ambiguous.** A time from a real-time feed carries the word *live* and a radio icon; any other says *scheduled*.

## Tokens

Declared in `src/styles/app.css` on `:root` and `:root[data-theme="dark"]`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--ground` | `#f0f2f4` | `#1b1f25` | Behind the map before tiles arrive |
| `--paper` | `#ffffff` | `#1f2329` | Panels, search field, chips |
| `--paper-2` | `#f3f5f8` | `#282d35` | Hover, inset fields, skeletons |
| `--paper-3` | `#e7eaf0` | `#333945` | Icon discs, neutral line badge |
| `--ink` | `#1b1f27` | `#eef1f6` | Text |
| `--ink-2` | `#4a5160` | `#bcc4d2` | Secondary text |
| `--ink-3` | `#5f6878` | `#9aa4b5` | Placeholders, notes |
| `--action` | `#1a66d9` | `#8ab4ff` | Primary button, links, selection, the route |
| `--action-deep` | `#1554b8` | `#a8c7ff` | Hover of the above |
| `--action-soft` | `#e8f0fd` | `#22324d` | Tinted discs, pressed buttons |
| `--ok` | `#1a7f4b` | `#5fd39a` | Live times, cycle paths, bike stations |
| `--warn` | `#a85008` | `#f5b461` | Delays, alerts |
| `--danger` | `#b3261e` | `#ff8a80` | Invalid input |

Text on `--paper` meets WCAG AA at every level of ink. The map has its own two palettes in `src/map/style.ts` (a neutral ground, green parks, blue water) and the overlay colours beside them.

- **Radii**: 8 px small, 12 px fields and notices, 16 px panels and menus, full pills for the search field, chips and buttons, 20 px on the top corners of the sheet.
- **Elevation**: two shadows, `--shadow-1` for what floats on the map and `--shadow-2` for the panel and menus. Elements inside a panel are flat and separated by hairlines (`--rule`).
- **Spacing**: 16 px panel padding, 16 px between blocks, 8 to 12 px inside a row. Rows are at least 44 px tall, primary rows 52 to 56 px.
- **Motion**: 180 to 320 ms, `cubic-bezier(0.16, 1, 0.3, 1)`, only for a state change (the sheet moving, a toggle, a toast). All of it is removed under `prefers-reduced-motion`.

## Type

- **Figtree** (400, 600, 700) for everything read, with tabular numerals so times align. 16 px body, 14 px secondary, 13 px notes, 20 px screen titles, 17 to 18 px for the number that matters in a row (minutes to departure, trip duration).
- **Barlow Condensed** (700) only inside a line badge, where a narrow face keeps "TGV 8086" short.

## Components

- **Search field**: a 48 px pill with the directions button inside it. Results drop below it, grouped (saved and recent, stops, places).
- **Chips**: one per layer, under the search field; scroll sideways on a phone.
- **Floating buttons**: layers and my position, bottom right, above the sheet.
- **Sheet**: handle on phones; `peek` 176 px, `half` 52 % of the height, `full` leaves the search field visible.
- **Line badge**: vehicle icon and line name on the operator's colour.
- **Departure row**: badge, destination, live or scheduled, minutes and clock time.
- **Itinerary row**: the legs as badges and icons, times, changes, and the duration on the right.
- **Leg timeline**: time, a rail drawn in the leg's stroke, the place, then how to travel.
- **Toggle**, **segmented control**, **notice**, **toast**: standard forms; the same ones everywhere.

## Voice

Short, second person; French uses "tu", German "du". An error says what happened and what to do next, and names the service that did not answer.
