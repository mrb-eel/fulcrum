import { createHash } from "node:crypto";

function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Snapshots cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalize(value[key])])
    );
  }
  throw new Error(`Snapshots cannot contain values of type ${typeof value}.`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function fingerprint(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
