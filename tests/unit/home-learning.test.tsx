import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeLearning } from '@/components/home/HomeLearning';
import { writeCachedExpressions } from '@/lib/cache/expressions-cache';
import type { Expression } from '@/lib/types';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

function expr(id: string, english: string, pack = 'daily-core'): Expression {
  return {
    id,
    user_id: 'u1',
    daily_session_id: 'd1',
    date: '2026-07-23',
    english,
    chinese: `${english} 中文`,
    scenario: 's',
    formality: 'casual',
    example_sentence: 'ex',
    common_mistake: 'm',
    source: { pack },
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<HomeLearning> SWR', () => {
  it('paints instantly from cache without waiting for the network', () => {
    writeCachedExpressions('u1', ['daily-core'], [expr('a', 'cached word')]);
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // network never resolves
    render(<HomeLearning userId="u1" initialActivePacks={['daily-core']} />);
    // No skeleton wait — the cached word is on screen at first render.
    expect(screen.getByText('cached word')).toBeTruthy();
  });

  it('background revalidation replaces the cached list when the server answers', async () => {
    writeCachedExpressions('u1', ['daily-core'], [expr('a', 'stale word')]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ expressions: [expr('b', 'fresh word')] }),
      })),
    );
    render(<HomeLearning userId="u1" initialActivePacks={['daily-core']} />);
    expect(screen.getByText('stale word')).toBeTruthy(); // instant
    await waitFor(() => expect(screen.getByText('fresh word')).toBeTruthy()); // corrected
  });

  it('switching to content with a cached list paints it instantly while regenerate runs', async () => {
    writeCachedExpressions('u1', ['ielts'], [expr('i1', 'ielts cached', 'ielts')]);
    let resolveRegen: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('regenerate')
          ? new Promise((res) => {
              resolveRegen = res;
            })
          : Promise.resolve({ ok: true, json: async () => ({ expressions: [expr('d1', 'daily word')] }) }),
      ),
    );
    render(<HomeLearning userId="u1" initialActivePacks={['daily-core']} />);
    await userEvent.click(screen.getByText('雅思'));
    // Cached ielts list visible immediately, before regenerate resolves.
    expect(screen.getByText('ielts cached')).toBeTruthy();
    // Server reconciliation arrives → view updates to the authoritative list.
    resolveRegen({
      ok: true,
      json: async () => ({ expressions: [expr('i2', 'ielts fresh', 'ielts')] }),
    });
    await waitFor(() => expect(screen.getByText('ielts fresh')).toBeTruthy());
  });

  it('switch without cache falls back to the loading skeleton (no stale cross-content leak)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('regenerate')
          ? new Promise(() => {}) // pending
          : Promise.resolve({ ok: true, json: async () => ({ expressions: [expr('d1', 'daily word')] }) }),
      ),
    );
    render(<HomeLearning userId="u1" initialActivePacks={['daily-core']} />);
    await waitFor(() => expect(screen.getByText('daily word')).toBeTruthy());
    await userEvent.click(screen.getByText('雅思'));
    // No ielts cache → old daily words must NOT linger; loading state shows.
    expect(screen.queryByText('daily word')).toBeNull();
    expect(screen.getByText('正在换成新内容…')).toBeTruthy();
  });
});
