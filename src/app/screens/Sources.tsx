/**
 * Where everything comes from, and what each service is told. ways has no
 * server: this list is every place the page talks to.
 */
import { useEffect } from "preact/hooks";
import { type MessageKey, t } from "../../i18n";
import { ScreenHead } from "../../ui/ui";
import { hostOf } from "../prefs";
import { requestSnap } from "../Sheet";

const REPO = "https://github.com/maxgfr/ways";

interface Source {
  name: string;
  host: () => string;
  use: MessageKey;
  sent: MessageKey;
  link: string;
  linkLabel: MessageKey;
}

const SOURCES: Source[] = [
  {
    name: "OpenFreeMap",
    host: () => "tiles.openfreemap.org",
    use: "sources.tiles.use",
    sent: "sources.tiles.sent",
    link: "https://openfreemap.org/",
    linkLabel: "sources.link.site",
  },
  {
    name: "Transitous",
    host: () => hostOf("motis"),
    use: "sources.transitous.use",
    sent: "sources.transitous.sent",
    link: "https://transitous.org/sources/",
    linkLabel: "sources.link.feeds",
  },
  {
    name: "Valhalla (FOSSGIS)",
    host: () => hostOf("valhalla"),
    use: "sources.valhalla.use",
    sent: "sources.valhalla.sent",
    link: "https://valhalla.openstreetmap.de/",
    linkLabel: "sources.link.site",
  },
  {
    name: "Photon (komoot)",
    host: () => "photon.komoot.io",
    use: "sources.photon.use",
    sent: "sources.photon.sent",
    link: "https://photon.komoot.io/",
    linkLabel: "sources.link.site",
  },
  {
    name: "Nominatim",
    host: () => "nominatim.openstreetmap.org",
    use: "sources.nominatim.use",
    sent: "sources.nominatim.sent",
    link: "https://operations.osmfoundation.org/policies/nominatim/",
    linkLabel: "sources.link.policy",
  },
  {
    name: "ways-data",
    host: () => "maxgfr.github.io/ways-data",
    use: "sources.data.use",
    sent: "sources.data.sent",
    link: "https://github.com/maxgfr/ways-data",
    linkLabel: "sources.link.site",
  },
];

export function Sources() {
  useEffect(() => requestSnap("full"), []);
  return (
    <div class="stack">
      <ScreenHead title={t("sources.title")} />
      <p class="lead">{t("sources.intro")}</p>
      <ul class="sources">
        {SOURCES.map((s) => (
          <li key={s.name}>
            <h3>{s.name}</h3>
            <p class="muted small">{s.host()}</p>
            <p>{t(s.use)}</p>
            <p class="muted">{t(s.sent)}</p>
            <a href={s.link} target="_blank" rel="noopener noreferrer">
              {t(s.linkLabel)}
            </a>
          </li>
        ))}
      </ul>
      <section class="stack tight">
        <h3 class="section-title">{t("sources.osm.title")}</h3>
        <p>
          {t("sources.osm.text")}{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            © OpenStreetMap
          </a>
          {" · "}
          <a
            href="https://www.openstreetmap.org/fixthemap"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("sources.osm.fix")}
          </a>
        </p>
      </section>
      <section class="stack tight">
        <h3 class="section-title">{t("sources.contact.title")}</h3>
        <p>
          {t("sources.contact.text")}{" "}
          <a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">
            github.com/maxgfr/ways
          </a>
        </p>
      </section>
    </div>
  );
}
