/**
 * The share of the web export: a Cloudflare Worker that serves out/<id>/web unchanged. Nothing about
 * the page differs from the export that web-check verified.
 *
 * ACCESS (a var in share/wrangler.jsonc) decides who gets in:
 *   "public"   anyone with the link
 *   anything else, or unset: HTTP Basic authentication with the credentials deploy.sh set from Keychain
 *
 *   share/deploy.sh   uploads the checked export, and in private mode sets the credentials
 *
 * Every response, public or not, is kept out of search engines until the owner decides otherwise.
 */

interface Assets {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  readonly ASSETS: Assets;
  /** "public" serves without a password; anything else keeps the page private. */
  readonly ACCESS?: string;
  /** Unset until the deploy script has set them: the Worker then lets no one in. */
  readonly SHARE_USER?: string;
  readonly SHARE_PASSWORD?: string;
}

const PRIVATE_HEADERS: Readonly<Record<string, string>> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

/** Public: shared caches may keep a page for five minutes; still not indexed. */
const PUBLIC_HEADERS: Readonly<Record<string, string>> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "public, max-age=300",
  "Referrer-Policy": "no-referrer",
};

/** Compares in time independent of where the strings differ, so the password cannot be probed byte by byte. */
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function authorised(request: Request, env: Env): boolean {
  const { SHARE_USER: expectedUser, SHARE_PASSWORD: expectedPassword } = env;
  if (expectedUser === undefined || expectedPassword === undefined || expectedPassword.length < 16) return false;
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return false;
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  // Both compared every time, so a wrong user name takes as long as a wrong password.
  const user = same(decoded.slice(0, colon), expectedUser);
  const password = same(decoded.slice(colon + 1), expectedPassword);
  return user && password;
}

function withHeaders(response: Response, headers: Readonly<Record<string, string>>): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) out.headers.set(name, value);
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.ACCESS === "public") return withHeaders(await env.ASSETS.fetch(request), PUBLIC_HEADERS);
    if (!authorised(request, env)) {
      return new Response("Private preview.\n", {
        status: 401,
        headers: { ...PRIVATE_HEADERS, "WWW-Authenticate": 'Basic realm="Creative Systems Lab", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return withHeaders(await env.ASSETS.fetch(request), PRIVATE_HEADERS);
  },
};
