import { render } from "preact";
import { App } from "./app/App";

const root = document.getElementById("app");
if (root) render(<App />, root);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
