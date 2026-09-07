/**
 * @jest-environment node
 */
/*
 * Same-origin (CSRF) guard for the partner Route Handlers (CAT-C-3.14). The node
 * env gives a real global Response (the guard constructs one on rejection; jsdom
 * has none). The guard is the parity replacement for Next's built-in
 * Server-Action POST-only + Origin/Host defense, lost when the cabinet moved off
 * Server Actions — so "rejects cross-origin" is the security-critical assertion.
 */
import { assertSameOrigin } from '@/lib/partner/same-origin';

function reqWith(headers: Record<string, string | undefined>): Request {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Request;
}

describe('assertSameOrigin', () => {
  it('passes a same-origin POST (Origin host === Host)', () => {
    expect(
      assertSameOrigin(
        reqWith({ origin: 'http://localhost:3000', host: 'localhost:3000' }),
      ),
    ).toBeNull();
  });

  it('passes when the Origin matches X-Forwarded-Host (Railway edge)', () => {
    expect(
      assertSameOrigin(
        reqWith({
          origin: 'https://nirivio.by',
          host: 'web.railway.internal',
          'x-forwarded-host': 'nirivio.by',
        }),
      ),
    ).toBeNull();
  });

  it('rejects a cross-origin POST with 403 {ok:false,code:CSRF}', async () => {
    // Honesty-audit boundary (2026-09-07): 'evil.example' shares no suffix with
    // 'nirivio.by', so this fixture cannot tell `===` from `.endsWith()` —
    // replacing the equality with a suffix match keeps all 481 tests green
    // (mutation M57), and 'https://evilnirivio.by' would then pass as
    // same-origin. The missing fixture is a suffix-shaped attacker origin.
    const res = assertSameOrigin(
      reqWith({ origin: 'https://evil.example', host: 'nirivio.by' }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.json()).toEqual({ ok: false, code: 'CSRF' });
  });

  it('rejects a request with no Origin header', () => {
    expect(assertSameOrigin(reqWith({ host: 'nirivio.by' }))?.status).toBe(403);
  });

  it('rejects when neither X-Forwarded-Host nor Host is present', () => {
    expect(
      assertSameOrigin(reqWith({ origin: 'https://nirivio.by' }))?.status,
    ).toBe(403);
  });

  it('rejects a malformed Origin', () => {
    expect(
      assertSameOrigin(reqWith({ origin: 'not a url', host: 'nirivio.by' }))
        ?.status,
    ).toBe(403);
  });

  it('prefers X-Forwarded-Host over Host — matching the internal Host is not a bypass', () => {
    const res = assertSameOrigin(
      reqWith({
        origin: 'http://web.railway.internal',
        host: 'web.railway.internal',
        'x-forwarded-host': 'nirivio.by',
      }),
    );
    expect(res?.status).toBe(403);
  });
});
