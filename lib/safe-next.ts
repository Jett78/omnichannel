/**
 * Validate a post-auth redirect target ("next" query param). Only
 * same-origin relative paths are allowed — anything else (absolute
 * URLs, protocol-relative //host, backslash tricks) is rejected so
 * the parameter can never become an open redirect.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /\s/.test(value)) return null;
  return value;
}
