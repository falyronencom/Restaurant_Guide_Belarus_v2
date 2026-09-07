/**
 * @jest-environment node
 */
/*
 * Account Route Handlers (user-ЛК Slice 1) — transport layer on the cabinet
 * pattern (mirrors partner-routes.test): the same-origin guard runs first
 * (cross-origin → 403, operation untouched), the body is parsed/validated, and
 * the operation's {ok,…} envelope returns verbatim. Node env: the guard's 403
 * is a real global Response; NextResponse.json is stubbed; operations mocked.
 */
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/account/operations', () => ({
  loadFavorites: jest.fn(),
  loadProfile: jest.fn(),
  updateProfile: jest.fn(),
}));

import { POST as favoritesListPost } from '@/app/api/account/favorites/list/route';
import { POST as profileLoadPost } from '@/app/api/account/profile/load/route';
import { POST as profileUpdatePost } from '@/app/api/account/profile/update/route';
import {
  loadFavorites,
  loadProfile,
  updateProfile,
} from '@/lib/account/operations';

const SAME = { origin: 'http://localhost:3000', host: 'localhost:3000' };
const CROSS = { origin: 'http://evil.example', host: 'localhost:3000' };

function makeRequest(headers: Record<string, string>, body?: unknown): Request {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as Request;
}

beforeEach(() => jest.clearAllMocks());

describe('same-origin guard on the account handlers', () => {
  it('blocks a cross-origin favorites list POST with 403', async () => {
    const res = await favoritesListPost(makeRequest(CROSS));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'CSRF' });
    expect(loadFavorites).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin profile load POST with 403', async () => {
    const res = await profileLoadPost(makeRequest(CROSS));
    expect(res.status).toBe(403);
    expect(loadProfile).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin profile update POST with 403', async () => {
    const res = await profileUpdatePost(makeRequest(CROSS, { name: 'X' }));
    expect(res.status).toBe(403);
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

describe('favorites list — page parsing', () => {
  it('defaults to page 1 when there is no body', async () => {
    (loadFavorites as jest.Mock).mockResolvedValue({ ok: true, favorites: [] });
    const res = await favoritesListPost(makeRequest(SAME));
    expect(res.status).toBe(200);
    expect(loadFavorites).toHaveBeenCalledWith(1);
  });

  it('forwards a valid page from the body', async () => {
    (loadFavorites as jest.Mock).mockResolvedValue({ ok: true, favorites: [] });
    await favoritesListPost(makeRequest(SAME, { page: 3 }));
    expect(loadFavorites).toHaveBeenCalledWith(3);
  });

  it('falls back to page 1 on a non-integer or sub-1 page', async () => {
    (loadFavorites as jest.Mock).mockResolvedValue({ ok: true, favorites: [] });
    await favoritesListPost(makeRequest(SAME, { page: 0 }));
    // Honesty audit 2026-09-07: a non-integer NUMBER is what exercises
    // Number.isInteger — 0 is caught by the range check and 'x' by the type
    // check, so without this line the integer guard was guarded by nothing.
    await favoritesListPost(makeRequest(SAME, { page: 2.5 }));
    await favoritesListPost(makeRequest(SAME, { page: 'x' }));
    expect((loadFavorites as jest.Mock).mock.calls).toEqual([[1], [1], [1]]);
  });

  it('returns the operation envelope verbatim', async () => {
    const envelope = { ok: false, code: 'NO_SESSION' };
    (loadFavorites as jest.Mock).mockResolvedValue(envelope);
    const res = await favoritesListPost(makeRequest(SAME));
    expect(await res.json()).toEqual(envelope);
  });
});

describe('profile load / update', () => {
  it('load returns the operation envelope verbatim', async () => {
    const envelope = { ok: true, profile: { id: 'u1' } };
    (loadProfile as jest.Mock).mockResolvedValue(envelope);
    const res = await profileLoadPost(makeRequest(SAME));
    expect(await res.json()).toEqual(envelope);
  });

  it('update rejects a missing body with 400 BAD_REQUEST', async () => {
    const res = await profileUpdatePost(makeRequest(SAME));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: 'BAD_REQUEST' });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('update rejects an empty/whitespace name with 400', async () => {
    const res1 = await profileUpdatePost(makeRequest(SAME, { name: '' }));
    const res2 = await profileUpdatePost(makeRequest(SAME, { name: '   ' }));
    const res3 = await profileUpdatePost(makeRequest(SAME, { name: 42 }));
    expect([res1.status, res2.status, res3.status]).toEqual([400, 400, 400]);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('update forwards the raw name and returns the envelope', async () => {
    const envelope = { ok: true, user: { id: 'u1', name: 'Вася' } };
    (updateProfile as jest.Mock).mockResolvedValue(envelope);
    const res = await profileUpdatePost(makeRequest(SAME, { name: ' Вася ' }));
    expect(updateProfile).toHaveBeenCalledWith(' Вася '); // backend trims
    expect(await res.json()).toEqual(envelope);
  });
});
