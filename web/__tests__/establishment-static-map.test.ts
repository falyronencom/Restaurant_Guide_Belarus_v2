/**
 * yandexStaticMapUrl — the Yandex Static API URL builder behind MapPreview.
 *
 * Locks the request format (v1 endpoint, longitude-first `ll`, in-bounds
 * size/zoom, raw unescaped commas) and the key-gating contract: no key → null,
 * so the card falls back to its placeholder instead of requesting a broken map.
 */
import { yandexStaticMapUrl } from '@/lib/establishment-helpers';

describe('yandexStaticMapUrl', () => {
  // Minsk centre, arbitrary venue coords.
  const LAT = 53.902284;
  const LON = 27.561831;

  it('returns null when no API key is configured', () => {
    expect(yandexStaticMapUrl(LAT, LON, undefined)).toBeNull();
    expect(yandexStaticMapUrl(LAT, LON, '')).toBeNull();
  });

  it('targets the Static API v1 endpoint', () => {
    const url = yandexStaticMapUrl(LAT, LON, 'KEY') as string;
    expect(url.startsWith('https://static-maps.yandex.ru/v1?')).toBe(true);
  });

  it('puts longitude before latitude in ll (Yandex convention)', () => {
    const url = yandexStaticMapUrl(LAT, LON, 'KEY') as string;
    expect(url).toContain(`ll=${LON},${LAT}`);
  });

  it('passes the apikey through', () => {
    const url = yandexStaticMapUrl(LAT, LON, 'secret-key-123') as string;
    expect(url).toContain('apikey=secret-key-123');
  });

  it('keeps size and zoom within the API limits (≤650×450, z≤17)', () => {
    // Honesty-audit note (2026-09-07): this is a BOUND, not a pin — z=1 passes
    // it too (mutation M50). If the preview FRAME is the real subject, the bound
    // has to become two-sided. Owner's call, left as is.
    const url = yandexStaticMapUrl(LAT, LON, 'KEY') as string;
    const size = /[?&]size=(\d+),(\d+)/.exec(url);
    const zoom = /[?&]z=(\d+)/.exec(url);
    expect(size).not.toBeNull();
    expect(zoom).not.toBeNull();
    expect(Number(size![1])).toBeLessThanOrEqual(650);
    expect(Number(size![2])).toBeLessThanOrEqual(450);
    expect(Number(zoom![1])).toBeLessThanOrEqual(17);
  });

  it('leaves the ll/size commas unescaped (Yandex example format)', () => {
    const url = yandexStaticMapUrl(LAT, LON, 'KEY') as string;
    expect(url).not.toContain('%2C');
  });
});
