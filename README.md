# ways

A map of how to get around, built only on open data. Search a place, get directions by public transport, bike or foot, see the next departures at a stop, find a shared bike, follow the cycle paths.

**[maxgfr.github.io/ways](https://maxgfr.github.io/ways/)**

No account, no server, no API key, no tracking. ways is a static page: your browser talks straight to community-run open services, and the app says which one it is calling.

## What it does

- **Search** places (Photon) and stops (Transitous), with what you saved and looked up recently first.
- **Directions** by public transport, bike and foot, with live times where the operator publishes them. Each way of travelling has its own stroke, on the map and in the list: a solid line for a ride, dashes by bike, dots on foot.
- **Stops**: next departures, marked _live_ or _scheduled_, delays, cancellations, service alerts, and the run of a line on the map.
- **Layers**: stops, cycle paths, shared bikes and scooters with what is available now, vehicles in service.
- **Yours, on your device**: saved places, recent searches, your preferred mode, flatter routes by bike, walking pace, step-free routes, theme and language are kept in this browser and nowhere else.
- **Offline**: installable; map areas you have seen stay available, and you can keep an area down to street level.
- **Local mode**: one setting stops every call to a service. Routing on the device itself, from downloadable regions, is being built.
- English and French.

## What leaves your device

Nothing is stored anywhere but your browser. A request leaves only when you do something that needs it, to these services:

| Service                                                  | Used for                                                                   | Receives                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [OpenFreeMap](https://openfreemap.org/)                  | The map                                                                    | The map areas you look at                                                                 |
| [Transitous](https://transitous.org/)                    | Transit trips, departures, stops, live vehicles, shared bikes, stop search | Both ends of a trip you ask for, the map area for stops and vehicles, the text you search |
| [Valhalla](https://valhalla.openstreetmap.de/) (FOSSGIS) | Bike and foot routes                                                       | Both ends of the trip and your travel preferences                                         |
| [Photon](https://photon.komoot.io/) (komoot)             | Place search, address of a pressed point                                   | The text you search and the centre of the map                                             |
| [Nominatim](https://nominatim.openstreetmap.org/)        | Opening hours, website, phone of a place                                   | The reference of the place whose card you open                                            |

Trips are requested when you ask for one, never while you type. The same list is in the app, under _Data sources_. You can point ways at your own MOTIS and Valhalla servers in the settings.

These services are run by volunteers and answer on a best-effort basis. Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Timetables come from the operators' own feeds, listed at [transitous.org/sources](https://transitous.org/sources/).

## Development

Needs [Bun](https://bun.sh).

```sh
bun install
bun run dev        # http://localhost:5173/ways/
bun run typecheck
bun run lint
bun test src scripts
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
```

Adding a language: copy `src/i18n/en.ts`, translate the values, register it in `src/i18n/index.ts`.

## Licence

MIT. ways is open source and non-commercial.
