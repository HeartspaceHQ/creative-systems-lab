export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(",");
const MAX_BYTES = 25 * 1024 * 1024;

/** A plain sentence when the file cannot be uploaded, or null when it can. */
export function imageProblem(file: File): string | null {
  if (!ACCEPTED_TYPES.some((type) => type === file.type)) {
    return `${file.name} is not a PNG, JPEG or WebP image. Save or export it in one of those formats.`;
  }
  if (file.size > MAX_BYTES) {
    return `${file.name} is larger than 25 MB. Export a smaller version and try again.`;
  }
  return null;
}
