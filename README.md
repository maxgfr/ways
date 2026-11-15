# ways

A map of how to get around, built only on open data. Search a place, get directions by public transport, bike or foot, see the next departures at a stop, find a shared bike, follow the cycle paths.

**[maxgfr.github.io/ways](https://maxgfr.github.io/ways/)**

No account, no server, no API key, no tracking. ways is a static page: your browser talks straight to community-run open services, and the app says which one it is calling.

## What it does

- **Search** places (Photon) and stops (Transitous), with what you saved and looked up recently first.
- **Places on the map**: shops, restaurants, museums… with their icon; a tap opens their card, with opening hours, website and phone found automatically.
- **Categories**: restaurants, cafés, bars, groceries, pharmacies, hotels and museums in the area on screen, listed by distance and marked on the map. Read from the map tiles already on screen: nothing is sent.
- **Directions** by public transport, bike and foot, with live times where the operator publishes them. Each way of travelling has its own stroke, on the map and in the list: a solid line for a ride, dashes by bike, dots on foot.
- **Stops**: next departures, marked _live_ or _scheduled_, delays, cancellations, service alerts, and the run of a line on the map.
- **Layers**: stops, cycle paths, shared bikes and scooters with what is available now, vehicles in service.
- **Yours, on your device**: saved places, recent searches, your preferred mode, flatter routes by bike, walking pace, step-free routes, theme and language are kept in this browser and nowhere else.
- **Opens where you are**: on your position when you allowed it before, otherwise on your city as your device's time zone tells it. No network is asked to guess.
- **Offline**: installable; map areas you have seen stay available. The timetables and streets of the areas you look things up in download on their own, so trips there keep working without a network.
- **Local mode**: one setting stops every call to a service. Trips are then computed in your browser from the offline data: public transport on the timetable, bike and foot on the street network. Nothing about the trip leaves the device.
- English, French and German.

## What leaves your device

Nothing is stored anywhere but your browser. A request leaves only when you do something that needs it, to these services:

| Service                                                  | Used for                                                                   | Receives                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [OpenFreeMap](https://openfreemap.org/)                  | The map                                                                    | The map areas you look at                                                                 |
| [Transitous](https://transitous.org/)                    | Transit trips, departures, stops, live vehicles, shared bikes, stop search | Both ends of a trip you ask for, the map area for stops and vehicles, the text you search |
| [Valhalla](https://valhalla.openstreetmap.de/) (FOSSGIS) | Bike and foot routes                                                       | Both ends of the trip and your travel preferences                                         |
| [Photon](https://photon.komoot.io/) (komoot)             | Place search, address of a pressed point                                   | The text you search and the centre of the map                                             |
| [Nominatim](https://nominatim.openstreetmap.org/)        | Opening hours, website, phone of a place                                   | The reference of the place whose card you open                                            |
| This site (`maxgfr.github.io/ways-data`)                 | Offline data for the areas you look things up in                           | Which area's files are downloaded                                                         |

Trips are requested when you ask for one, never while you type. The same list is in the app, under _Data sources_. You can point ways at your own MOTIS and Valhalla servers in the settings.

These services are run by volunteers and answer on a best-effort basis. Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Timetables come from the operators' own feeds, listed at [transitous.org/sources](https://transitous.org/sources/).

## Three modes

- **Auto** (default): the open services are asked first; when they do not answer and offline data covers the trip, it is computed on the device.
- **Online**: Transitous for public transport, Valhalla for bike and foot. Live times where operators publish them, anywhere in the world.
- **Local**: no service is called at all. Trips come from the offline data, on the timetable only (no live times). Search covers what you saved and the stops held offline. Only map tiles still load, unless you kept the area offline.

## Offline data

Nobody picks the cities. Every night, [maxgfr/ways-data](https://github.com/maxgfr/ways-data) reads the [Mobility Database](https://mobilitydatabase.org/) catalogue of the world's public transport feeds, keeps the urban networks, ranks them by the size of their feed and builds the biggest ones, one per city: the next three days of timetables, the stops and line colours from the operator's GTFS feed, and the streets of the city centre from OpenStreetMap. It publishes them at `maxgfr.github.io/ways-data/`, on the same origin as the app.

In the app, the data of an area downloads by itself when you look up a place, a stop or a trip there, or when your position is in it, and is kept up to date. It is not downloaded on a connection set to save data, and the settings turn it off. They also list what the device holds, with its size, and remove it.

On the device, public transport is routed with [minotor](https://github.com/aubryio/minotor) (RAPTOR) and the streets with an A\* search over a compact graph (`src/local`), both in a web worker. Lines are drawn straight from stop to stop: the data does not carry the shape of the tracks. Street networks are rebuilt a few per night; until an area has its own, walks there are estimated in a straight line.

## Development

Needs [Bun](https://bun.sh).

```sh
bun install
bun run dev        # http://localhost:5173/ways/
bun run typecheck
bun run lint
bun run test       # unit tests, including routing on a made-up region
bun run regions    # discovers and builds the offline data into dist-data (slow, networked)
bun run test:e2e   # builds, then Playwright on a desktop and a phone viewport
```

The end-to-end tests answer every service locally with made-up data: they send nothing to the real ones.

The stack: TypeScript, Preact with signals, MapLibre GL, a build script around `Bun.build` that emits a strict Content-Security-Policy and a service worker. Everything the page loads comes from the site itself; only data requests go out.

```
src/app        screens, routing in the URL hash, preferences
src/map        the map and its layers
src/providers  one module per service, translated into a common model
src/i18n       translation catalogues (en is the source and the fallback)
src/store      what the user keeps, in IndexedDB
src/local      routing on the device: street graph, timetable, worker, offline data
data           discovers the networks and builds the offline data
```

Translations are standard JSON bundles in `src/i18n/locales/`: `en.json` is the source and the fallback, and a test checks that every other bundle has the same keys and placeholders. German was added with [ultrai18n](https://github.com/maxgfr/ultrai18n): seed `de.json` from `en.json`, then `scan --from en --to de`, `plan`, `translate`, `apply --write`, and `plurals` and `sync` to check. A new language is a new bundle and one line in `LANGS` (`src/i18n/index.ts`).

## Licence

MIT. ways is open source and non-commercial.
