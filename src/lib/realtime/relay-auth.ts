import { createServerClient } from '@supabase/ssr';

/**
 * The realtime WS relay authenticates on the raw HTTP `upgrade` request, which is
 * NOT inside a Next request context — so `next/headers` cookies() is unavailable.
 * These helpers read the Supabase session straight from the raw Cookie header and
 * reject the upgrade before any OpenAI connection is opened (else anyone could burn
 * our OPENAI_API_KEY).
 */

export interface RawCookie {
  name: string;
  value: string;
}

/** Parses a raw `Cookie:` header into the {name,value}[] shape @supabase/ssr wants. */
export function parseCookieHeader(header: string | undefined): RawCookie[] {
  if (!header) return [];
  const out: RawCookie[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue; // malformed / empty segment
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const rawValue = part.slice(eq + 1).trim();
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      // Not valid percent-encoding (e.g. a stray %) — keep the raw value.
    }
    out.push({ name, value });
  }
  return out;
}

interface UpgradeAuthClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> };
}

interface AuthDeps {
  /** Injectable for tests; defaults to a real Supabase server client. */
  makeClient?: (cookies: RawCookie[]) => UpgradeAuthClient;
}

function defaultClient(cookies: RawCookie[]): UpgradeAuthClient {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookies,
        setAll: () => {
          // read-only: the WS upgrade never sets cookies
        },
      },
    },
  ) as unknown as UpgradeAuthClient;
}

/**
 * Validates the Supabase session on a WS upgrade. Returns the user id, or null if
 * unauthenticated. Fails CLOSED: any error (bad token, network) → null, never throws.
 */
export async function authenticateUpgrade(
  cookieHeader: string | undefined,
  deps: AuthDeps = {},
): Promise<string | null> {
  const cookies = parseCookieHeader(cookieHeader);
  if (cookies.length === 0) return null;
  const make = deps.makeClient ?? defaultClient;
  try {
    const supabase = make(cookies);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}
