/** Hand-written decoders: the API's JSON is `unknown` until it has been checked here. */

type Rec = Readonly<Record<string, unknown>>;

export class DecodeError extends Error {}

function fail(path: string, expected: string): never {
  throw new DecodeError(`unexpected response: ${path} is not ${expected}`);
}

export function rec(value: unknown, path = "response"): Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "an object");
  }
  return value as Rec;
}

export function str(o: Rec, key: string): string {
  const value = o[key];
  return typeof value === "string" ? value : fail(key, "a string");
}

export function num(o: Rec, key: string): number {
  const value = o[key];
  return typeof value === "number" ? value : fail(key, "a number");
}

export function bool(o: Rec, key: string): boolean {
  const value = o[key];
  return typeof value === "boolean" ? value : fail(key, "a boolean");
}

export function optStr(o: Rec, key: string): string | null {
  const value = o[key];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : fail(key, "a string or null");
}

export function list<T>(value: unknown, key: string, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    return fail(key, "an array");
  }
  return (value as unknown[]).map(decode);
}

export function field<T>(o: Rec, key: string, decode: (item: unknown) => T): T[] {
  return list(o[key], key, decode);
}

export function oneOf<T extends string>(o: Rec, key: string, allowed: readonly T[]): T {
  const value = str(o, key);
  const found = allowed.find((candidate) => candidate === value);
  return found ?? fail(key, `one of ${allowed.join(", ")}`);
}

export function optNum(o: Rec, key: string): number | null {
  const value = o[key];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number" ? value : fail(key, "a number or null");
}

export function optBool(o: Rec, key: string): boolean | null {
  const value = o[key];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "boolean" ? value : fail(key, "a boolean or null");
}

export function text(item: unknown): string {
  return typeof item === "string" ? item : "";
}
