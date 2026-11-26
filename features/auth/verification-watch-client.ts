/**
 * Browser side of the verification watch (see lib/verification-watch.ts
 * for the design). The watch id lives only in this browser's
 * localStorage; the server stores just its hash.
 */
const STORAGE_KEY = "uoi:verify-watch";

interface StoredWatch {
  email: string;
  watchId: string;
}

function readStored(): StoredWatch | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "email" in parsed &&
      "watchId" in parsed &&
      typeof (parsed as StoredWatch).email === "string" &&
      typeof (parsed as StoredWatch).watchId === "string"
    ) {
      return parsed as StoredWatch;
    }
  } catch {
    // Storage unavailable (private mode etc.) — the flow just falls
    // back to the manual sign-in page.
  }
  return null;
}

async function post(path: string, email: string, watchId: string): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, watchId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Create + register a watch for a just-created account. */
export async function createVerificationWatch(email: string): Promise<void> {
  const watchId = crypto.randomUUID();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ email, watchId }));
  } catch {
    return;
  }
  await post("/api/auth/verification-watch/register", email, watchId);
}

/** The stored watch id for this email, or null. */
export function readVerificationWatch(email: string): string | null {
  const stored = readStored();
  return stored && stored.email.toLowerCase() === email.toLowerCase() ? stored.watchId : null;
}

/** Re-register the stored watch (heals overwrites and expiry). */
export async function registerVerificationWatch(email: string, watchId: string): Promise<void> {
  await post("/api/auth/verification-watch/register", email, watchId);
}

/** Exchange the watch for a session. True when this tab is now signed in. */
export async function exchangeVerificationWatch(
  email: string,
  watchId: string,
): Promise<boolean> {
  return post("/api/auth/verification-watch/exchange", email, watchId);
}

export function clearVerificationWatch(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
