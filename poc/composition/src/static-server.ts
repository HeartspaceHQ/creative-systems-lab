/**
 * A small static file server on 127.0.0.1 for the exported web page, so the browser loads it over
 * real HTTP the way a visitor would. Text is sent Brotli-compressed when the browser accepts it, as
 * any production host would do. Node only; for verification and measurement, not for hosting.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".png": "image/png",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
};

const COMPRESSED = new Set([".html", ".js", ".ts", ".css", ".json", ".txt"]);

/** Brotli at the quality a static host precompresses with. */
export const brotli = (bytes: Uint8Array): Buffer =>
  brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });

export interface Served {
  readonly url: string;
  readonly close: () => Promise<void>;
}

export async function serveDirectory(dir: string): Promise<Served> {
  const root = resolve(dir);
  // Compressed once per file, as a host serving precompressed files would: no compression time per request.
  const compressed = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    void (async () => {
      let path: string;
      try {
        path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (path.includes("\0")) {
        res.writeHead(400).end();
        return;
      }
      const file = resolve(root, `.${path.endsWith("/") ? `${path}index.html` : path}`);
      const type = TYPES[extname(file)];
      if (!file.startsWith(root + sep) || type === undefined) {
        res.writeHead(404).end();
        return;
      }
      let body: Buffer;
      try {
        body = await readFile(file);
      } catch {
        res.writeHead(404).end();
        return;
      }
      const headers: Record<string, string> = { "content-type": type, "cache-control": "no-cache" };
      if (COMPRESSED.has(extname(file)) && (req.headers["accept-encoding"] ?? "").includes("br")) {
        body = compressed.get(file) ?? brotli(body);
        compressed.set(file, body);
        headers["content-encoding"] = "br";
      }
      headers["content-length"] = String(body.length);
      res.writeHead(200, headers).end(body);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/`,
    close: () => new Promise((done) => { server.close(() => { done(); }); }),
  };
}
