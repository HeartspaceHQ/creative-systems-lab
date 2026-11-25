/** The only place that talks to the network: session token, JSON bodies, raw image and font uploads. */
import { rec, str } from "./decode";

/** A request the server refused, or could not be made. `fields` maps a body path to a plain sentence. */
export class ApiError extends Error {
  readonly fields: Readonly<Record<string, string>>;

  constructor(message: string, fields: Readonly<Record<string, string>> = {}) {
    super(message);
    this.fields = fields;
  }
}

type WriteMethod = "POST" | "PUT" | "DELETE";

let sessionToken: Promise<string | null> | null = null;

async function fetchToken(): Promise<string | null> {
  try {
    const response = await fetch("/api/session");
    if (!response.ok) return null;
    return str(rec(await response.json()), "token");
  } catch {
    return null;
  }
}

/** The per-process token is fetched once; a failed fetch is retried on the next write. */
async function session(refresh = false): Promise<string | null> {
  if (refresh) sessionToken = null;
  sessionToken ??= fetchToken();
  const token = await sessionToken;
  if (token === null) sessionToken = null;
  return token;
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function fieldMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(value)) {
    if (typeof message === "string") fields[key] = message;
  }
  return fields;
}

function failure(payload: unknown, response: Response): ApiError {
  try {
    const body = rec(payload);
    return new ApiError(str(body, "error"), fieldMap(body["fields"]));
  } catch {
    return new ApiError(`The studio could not do that (error ${String(response.status)}).`);
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch {
    throw new ApiError("Can't reach the studio. Check that it is still running, then try again.");
  }
}

async function settle(response: Response): Promise<unknown> {
  const payload = await parseBody(response);
  if (!response.ok) throw failure(payload, response);
  return payload;
}

export async function getJson(path: string): Promise<unknown> {
  const payload = await settle(await send(path, {}));
  if (payload === undefined) throw new ApiError("The studio sent back something unexpected.");
  return payload;
}

async function write(method: WriteMethod, path: string, headers: Record<string, string>, body?: BodyInit): Promise<unknown> {
  const attempt = async (refresh: boolean): Promise<Response> => {
    const token = await session(refresh);
    const all = token === null ? headers : { ...headers, "X-CSL-Session": token };
    return send(path, body === undefined ? { method, headers: all } : { method, headers: all, body });
  };
  let response = await attempt(false);
  if (response.status === 403) response = await attempt(true);
  return settle(response);
}

export function sendJson(method: WriteMethod, path: string, body?: unknown): Promise<unknown> {
  const headers = body === undefined ? {} : { "Content-Type": "application/json" };
  return write(method, path, headers, body === undefined ? undefined : JSON.stringify(body));
}

/** Raw image bytes with the image's own content type; the name travels in a header for display only. */
export function uploadImage(path: string, file: File): Promise<unknown> {
  const name = file.name.replace(/[^\x20-\x7e]/g, "_");
  return write("POST", path, { "Content-Type": file.type, "X-File-Name": name }, file);
}

/** Raw font bytes; the server reads what kind of font it is from the bytes, not from the name. */
export function uploadFont(path: string, file: File): Promise<unknown> {
  return write("POST", path, { "Content-Type": "application/octet-stream" }, file);
}
