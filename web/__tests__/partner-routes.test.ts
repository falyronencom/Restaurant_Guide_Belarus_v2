/**
 * @jest-environment node
 */
/*
 * Partner cabinet Route Handlers (CAT-C-3.14). Verifies the transport layer:
 * the same-origin guard runs first (cross-origin → 403, operation untouched),
 * the JSON body + [id] param are forwarded to the (mocked) operation, and the
 * operation's {ok,…} envelope is returned verbatim. Node env: the guard's 403 is
 * a real global Response. NextResponse.json is stubbed (it does not load here);
 * operations are mocked so no backend is reached.
 */
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/partner/operations', () => ({
  loadEstablishments: jest.fn(),
  createEstablishmentAction: jest.fn(),
  updateEstablishmentAction: jest.fn(),
  submitEstablishmentAction: jest.fn(),
  loadEstablishmentForEdit: jest.fn(),
  retryOcrAction: jest.fn(),
  deleteEstablishmentAction: jest.fn(),
}));
jest.mock('@/lib/partner/media-proxy', () => ({
  proxyMediaUpload: jest.fn(),
}));

import { POST as createPost } from '@/app/api/partner/establishments/create/route';
import { POST as deletePost } from '@/app/api/partner/establishments/[id]/delete/route';
import { POST as listPost } from '@/app/api/partner/establishments/list/route';
import { POST as loadPost } from '@/app/api/partner/establishments/[id]/load/route';
import { POST as mediaAttachPost } from '@/app/api/partner/establishments/[id]/media/route';
import { POST as retryPost } from '@/app/api/partner/establishments/[id]/retry-ocr/route';
import { POST as submitPost } from '@/app/api/partner/establishments/[id]/submit/route';
import { POST as updatePost } from '@/app/api/partner/establishments/[id]/update/route';
import { POST as mediaTempPost } from '@/app/api/partner/media/route';
import { proxyMediaUpload } from '@/lib/partner/media-proxy';
import {
  createEstablishmentAction,
  deleteEstablishmentAction,
  loadEstablishmentForEdit,
  loadEstablishments,
  retryOcrAction,
  submitEstablishmentAction,
  updateEstablishmentAction,
} from '@/lib/partner/operations';

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

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => jest.clearAllMocks());

/*
 * Guard coverage is exhaustive by construction (2026-09-08, honesty-audit
 * finding 4 closed): every partner Route Handler that exists has a cross-origin
 * case below — list, update, delete, create, submit, load, retry-ocr,
 * media-temp and media-attach, nine of nine. Each case is proved able to fail:
 * replacing `assertSameOrigin(request)` with `null` in one route file turns
 * exactly that route's case red and leaves the rest green. A tenth handler
 * added without its own case here breaks that property silently — the describe
 * would again cover less than its title claims.
 */

describe('same-origin guard on the partner handlers', () => {
  it('blocks a cross-origin list POST with 403 before the operation runs', async () => {
    const res = await listPost(makeRequest(CROSS));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'CSRF' });
    expect(loadEstablishments).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin [id] update POST before reading params/body', async () => {
    const res = await updatePost(makeRequest(CROSS, { name: 'X' }), ctx('e9'));
    expect(res.status).toBe(403);
    expect(updateEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin delete POST (destructive — guard must hold)', async () => {
    const res = await deletePost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(deleteEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin create POST before the body is parsed', async () => {
    const res = await createPost(makeRequest(CROSS, { name: 'X' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'CSRF' });
    expect(createEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin submit POST (moderation write — guard must hold)', async () => {
    const res = await submitPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(submitEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin load POST (authed read — may rotate the cookie)', async () => {
    const res = await loadPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(loadEstablishmentForEdit).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin retry-ocr POST', async () => {
    const res = await retryPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(retryOcrAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin temp media upload with 403 (OSB-P4 parity)', async () => {
    const res = await mediaTempPost(makeRequest(CROSS));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'CSRF' });
    expect(proxyMediaUpload).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin establishment media upload with 403 (OSB-P4 parity)', async () => {
    const res = await mediaAttachPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(proxyMediaUpload).not.toHaveBeenCalled();
  });

  it('passes a same-origin media upload through to the proxy with the right paths', async () => {
    (proxyMediaUpload as jest.Mock).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const tempReq = makeRequest(SAME);
    await mediaTempPost(tempReq);
    expect(proxyMediaUpload).toHaveBeenCalledWith(
      tempReq,
      '/api/v1/partner/media/upload',
    );

    const attachReq = makeRequest(SAME);
    await mediaAttachPost(attachReq, ctx('e9'));
    expect(proxyMediaUpload).toHaveBeenCalledWith(
      attachReq,
      '/api/v1/partner/establishments/e9/media',
    );
  });
});

describe('happy path — handlers forward to operations and return the envelope', () => {
  it('list returns the loadEstablishments envelope', async () => {
    (loadEstablishments as jest.Mock).mockResolvedValue({
      ok: true,
      establishments: [],
    });
    const res = await listPost(makeRequest(SAME));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, establishments: [] });
    expect(loadEstablishments).toHaveBeenCalledTimes(1);
  });

  it('create parses the JSON body and forwards it', async () => {
    (createEstablishmentAction as jest.Mock).mockResolvedValue({
      ok: true,
      id: 'e1',
      user: null,
    });
    const payload = { name: 'Кафе' };
    const res = await createPost(makeRequest(SAME, payload));
    expect(await res.json()).toEqual({ ok: true, id: 'e1', user: null });
    expect(createEstablishmentAction).toHaveBeenCalledWith(payload);
  });

  it('create returns 400 on a malformed body without calling the operation', async () => {
    const res = await createPost(makeRequest(SAME)); // no body → json() throws
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: 'BAD_REQUEST' });
    expect(createEstablishmentAction).not.toHaveBeenCalled();
  });

  it('update forwards the [id] param and the body', async () => {
    (updateEstablishmentAction as jest.Mock).mockResolvedValue({
      ok: true,
      status: 'draft',
    });
    const payload = { name: 'X' };
    const res = await updatePost(makeRequest(SAME, payload), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true, status: 'draft' });
    expect(updateEstablishmentAction).toHaveBeenCalledWith('e9', payload);
  });

  it('submit forwards the [id] param', async () => {
    (submitEstablishmentAction as jest.Mock).mockResolvedValue({
      ok: true,
      status: 'pending',
    });
    const res = await submitPost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true, status: 'pending' });
    expect(submitEstablishmentAction).toHaveBeenCalledWith('e9');
  });

  it('load forwards the [id] param', async () => {
    (loadEstablishmentForEdit as jest.Mock).mockResolvedValue({
      ok: true,
      establishment: { id: 'e9' },
    });
    const res = await loadPost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true, establishment: { id: 'e9' } });
    expect(loadEstablishmentForEdit).toHaveBeenCalledWith('e9');
  });

  it('retry-ocr forwards the [id] param', async () => {
    (retryOcrAction as jest.Mock).mockResolvedValue({ ok: true });
    const res = await retryPost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true });
    expect(retryOcrAction).toHaveBeenCalledWith('e9');
  });

  it('delete forwards the [id] param', async () => {
    (deleteEstablishmentAction as jest.Mock).mockResolvedValue({ ok: true });
    const res = await deletePost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteEstablishmentAction).toHaveBeenCalledWith('e9');
  });
});
