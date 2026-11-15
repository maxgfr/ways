# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Bun, TypeScript (strict), Preact with `@preact/signals`, MapLibre GL JS, OpenFreeMap vector tiles, Lucide icons, Fontsource fonts, Biome, `bun test`, Playwright. Static site on GitHub Pages, installable as a PWA. Same conventions as the author's other Bun apps (maxgfr/spots, maxgfr/toolbelt). Chosen by the author.

## Users

People who move around a city without a car: on foot, by public transport, by bike or on a shared bike or scooter. They open ways on a phone, outdoors, to decide how to get somewhere now, or at a desk to plan a trip. They want one map that answers "where is it", "how do I get there" and "when does the next one leave".

No mode is the primary one: pedestrians, transit riders and cyclists are served equally, on phone and desktop.

## Product Purpose

A map in the genre of Google Maps built only on open data and open services: search for a place, read what is there, get directions by public transport, bike or foot, see stops with their next departures, shared bikes with their availability, and cycle lanes. It exists so that this everyday tool can be used without an account, without tracking and without a company in the middle. Success is a person getting a correct answer to a trip question as fast as they would elsewhere, anywhere in the world where open data exists.

## Positioning

No backend of its own: the page talks straight to community-run open services (Transitous, FOSSGIS Valhalla, Photon, OpenFreeMap) and says which one it is calling. The routing engine is a setting: those online services, or a calculation done entirely in the browser on a region pack built from open data. Nothing about the user is stored anywhere but their own device.

## Operating Context

- Outdoors on a phone, one hand, variable light and network; and at a desk on a wide screen.
- Worldwide coverage through the online services. On-device routing only in regions that have a pack (`ways-data` repository, rebuilt nightly from GTFS and OpenStreetMap).
- Every third-party service is volunteer-run and best-effort. Any of them can be slow, rate-limited or down.
- Sibling of `spots` on the same origin (`maxgfr.github.io`): storage and cache names are namespaced `ways`.

## Capabilities and Constraints

- Search places and stops; place card; drop a pin by long press or right click.
- Directions by transit, bike, walk and shared vehicles, with a list of itineraries and a detail per leg.
- Stops with real-time departures and service alerts; live vehicles; shared bikes and scooters with availability; cycle lanes.
- Favourites and recent searches kept in the browser (IndexedDB). Map tiles cached for offline use.
- Travel preferences remembered on the device: preferred mode (transit, bike, walk), flatter routes by bike, walking pace, step-free routes.
- Settings: routing engine (auto, online, on device), custom service endpoints, optional personal API keys, language, theme.
- English and French, through translation catalogues; English is the source and the fallback.
- No server, no account, no analytics, no secret key in the code. Strict CSP. Everything is a static file.
- Fair use of third-party services is a hard constraint: directions are requested on an explicit action, never while typing; requests are debounced, cancelled and cached.
- Open source (MIT) and non-commercial, which the Transitous usage policy requires.
- Undecided: which regions get a pack after Rennes and Lyon; whether a keyed provider (IDFM PRIM) ships.

## Brand Commitments

- Name: `ways`, lowercase, like the author's other tools.
- Type: Barlow Condensed for anything printed on a label, Figtree for anything read. Inherited from spots.
- No gradients, no teardrop pins. State is shown by shape, never by hue alone.
- Tone: concise, second person; French uses "tu". An error says what happened and what to do next.
- Look: the standard of the genre, played straight, chosen by the author. White rounded panels, one blue for actions and for the route. The finish it is measured against is Google Maps. Its name, icon, wording and artwork are its own.

## Evidence on Hand

- No screenshots, users or metrics yet. Nothing of the kind may be invented.
- Live data is real and comes from the named services. Sample data in tests is fake and stays in tests.
- Route colours and line names come from the operators' own feeds.

## Product Principles

1. Say what leaves the device: each network destination is named where it is used, and nothing else leaves. When a trade-off appears, this one is never given up.
2. Works with nothing: no key, no account, no server.
3. Real time is either trustworthy or labelled as scheduled. Never show a guess as a fact.
4. The map is the product. Panels and controls step back from it.
5. A service can fail; the app says so and offers the other engine.

_Principles 3 to 5 are inferred from the brief._

## Accessibility & Inclusion

WCAG 2.2 AA. Everything shown on the map is also reachable as a list. Keyboard operable. Reduced motion and the system colour scheme are respected. Line colours from operators are never the only carrier of meaning: a line always shows its name.
