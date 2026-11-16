/**
 * Static server for the dev loop and the end-to-end tests. It serves the app
 * under /ways/ from dist/, and the regions under /ways/data/ from dist-data/,
 * where the deploy unpacks them.
 */
import { join, normalize } from "node:path";

const ROOT = join(import.meta.dir, "..");

export function serveApp(opts: { port: number; dir: string; dataDir?: string }) {
  const dataDir = opts.dataDir ?? join(ROOT, "dist-data");
  return Bun.serve({
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url);
      let path = decodeURIComponent(url.pathname);
      let dir = opts.dir;
      if (path.startsWith("/ways/data/")) {
        dir = dataDir;
        path = path.slice("/ways/data".length);
      } else path = path.replace(/^\/ways(?=\/|$)/, "");
      if (path === "" || path.endsWith("/")) path += "index.html";
      const file = Bun.file(join(dir, normalize(path).replace(/^(\.\.[/\\])+/, "")));
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file);
    },
  });
}

if (import.meta.main) {
  const server = serveApp({
    port: Number(process.env.PORT ?? 4317),
    dir: join(ROOT, "dist"),
  });
  console.log(`serving dist/ on http://localhost:${server.port}/ways/`);
}
