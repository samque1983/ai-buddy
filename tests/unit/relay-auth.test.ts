import { describe, it, expect } from 'vitest';
import { parseCookieHeader, authenticateUpgrade } from '@/lib/realtime/relay-auth';

describe('parseCookieHeader', () => {
  it('parses multiple cookies', () => {
    expect(parseCookieHeader('a=1; b=2')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);
  });

  it('keeps = inside the value (base64 padding / JWT)', () => {
    const r = parseCookieHeader('sb-access-token=eyJ.a.b==; x=1');
    expect(r).toContainEqual({ name: 'sb-access-token', value: 'eyJ.a.b==' });
  });

  it('trims whitespace and skips malformed pairs', () => {
    expect(parseCookieHeader('  a = 1 ; ; b=2 ')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);
  });

  it('url-decodes values', () => {
    expect(parseCookieHeader('a=%20x%20')).toEqual([{ name: 'a', value: ' x ' }]);
  });

  it('leaves an undecodable value as-is instead of throwing', () => {
    expect(parseCookieHeader('a=%zz')).toEqual([{ name: 'a', value: '%zz' }]);
  });

  it('returns [] for missing / empty headers', () => {
    expect(parseCookieHeader(undefined)).toEqual([]);
    expect(parseCookieHeader('')).toEqual([]);
  });
});

// Injectable supabase-like client so we never hit the network in a unit test.
function fakeClientFactory(user: { id: string } | null, throws = false) {
  return () => ({
    auth: {
      getUser: async () => {
        if (throws) throw new Error('network');
        return { data: { user }, error: null };
      },
    },
  });
}

describe('authenticateUpgrade', () => {
  it('returns the user id for a valid session cookie', async () => {
    const uid = await authenticateUpgrade('sb-access-token=valid', {
      makeClient: fakeClientFactory({ id: 'user-123' }),
    });
    expect(uid).toBe('user-123');
  });

  it('returns null when there is no user', async () => {
    const uid = await authenticateUpgrade('sb-access-token=expired', {
      makeClient: fakeClientFactory(null),
    });
    expect(uid).toBeNull();
  });

  it('returns null when there is no cookie header', async () => {
    const uid = await authenticateUpgrade(undefined, {
      makeClient: fakeClientFactory({ id: 'nope' }),
    });
    expect(uid).toBeNull();
  });

  it('fails closed (null) when validation throws', async () => {
    const uid = await authenticateUpgrade('sb-access-token=x', {
      makeClient: fakeClientFactory(null, true),
    });
    expect(uid).toBeNull();
  });
});
