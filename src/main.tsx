import { render } from "preact";
import { App } from "./app/App";
import { deviceLookup } from "./local/client";
import { setDeviceLookup } from "./providers/router";

// Trips can be computed on this device where a downloaded region covers them.
setDeviceLookup(deviceLookup);

const root = document.getElementById("app");
if (root) render(<App />, root);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
