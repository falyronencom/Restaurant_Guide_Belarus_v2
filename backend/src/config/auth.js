/**
 * Refresh-token reuse grace window
 *
 * Strict rotation treats every second presentation of a refresh token as
 * theft: authService.refreshAccessToken revokes every session the user has
 * and logs a SECURITY ALERT. That verdict is right for a stolen token and
 * wrong for a lost response — the server rotated, the answer never arrived,
 * and the legitimate client is left holding a token the database has burned.
 *
 * The clients replay that token by themselves, with no retry logic of their
 * own: the Dio error interceptor retries any 5xx after 0.5 / 1 / 1.5 s
 * (mobile and admin-web, Environment.maxRetryAttempts = 3) and /auth/refresh
 * is not excluded from that branch. With Railway's drain at its platform
 * default of 0 s a redeploy kills the process between the commit and the
 * response, the edge turns the dropped upstream into a 502, and the retry
 * presents an already-burned token. Worst case that retry lands about 31 s
 * after the rotation: the client's own 30 s receive timeout plus the first
 * backoff. A response that never arrives at all is not a 5xx and is never
 * retried automatically — only the 502 shape reaches this window.
 *
 * Inside the window a replay returns THE SAME successor instead of a new
 * pair, so the chain never branches and the client survives the lost answer.
 * The price is symmetric: an attacker holding a token burned less than N
 * seconds ago receives that successor too, and from there competes with the
 * victim exactly as today. Coordinator decision 2026-09-10
 * (docs/strategic_decisions_log.md): window accepted at N = 60 s — the
 * smallest round value above the client's worst case, top of the industry
 * range (Auth0 reuse interval, 10-60 s).
 *
 * 0 disables the window: every replay of a burned token is theft again. It is
 * NOT a full return to the behaviour that preceded this feature, and the
 * difference is worth knowing before reaching for it as a rollback. The claim
 * on the predecessor is atomic now, so two simultaneous refreshes of one token
 * can no longer both succeed — they used to fork the chain silently, which is
 * also why a racing thief was undetectable. The caller that loses that claim
 * is answered from the successor regardless of this setting
 * (authService.handleReusedToken, `concurrentClaim`); only stale replays are
 * governed by the number below.
 *
 * Pure: reads the env object it is given, never process.env, and returns the
 * warning instead of logging it — server.js logs it at startup.
 */

/** Coordinator decision 2026-09-10. Used when the variable is absent. */
export const DEFAULT_REFRESH_REUSE_GRACE_SECONDS = 60;

/**
 * Ceiling for a configured value. Not a security boundary — a typo guard: an
 * extra digit (600 for 60) must not silently widen the window tenfold on a
 * service nobody rereads. Legitimate values live in the 10-60 s range.
 */
export const MAX_REFRESH_REUSE_GRACE_SECONDS = 300;

/**
 * Strict non-negative integer parse: '60' → 60; undefined, '', '60s', '-1'
 * and '6e1' → null. Strictness matters — a typo must fall back to the
 * default, not become 0 and silently disarm the window.
 *
 * @param {*} value
 * @returns {number|null}
 */
const parseNonNegativeInt = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
};

/**
 * Resolve the reuse grace window from the environment.
 *
 * Called per refresh rather than once at boot: the value is read from the env
 * object on every call, so a test can vary it without reloading the module.
 *
 * @param {Object} [env] - Environment map (process.env in production)
 * @returns {{ seconds: number, warning: string|null }} seconds is 0 when the
 *   window is explicitly disabled; warning is non-null only on a malformed or
 *   clamped value and is logged once at startup, never per request
 */
export const resolveRefreshReuseGraceSeconds = (env = {}) => {
  const raw = env.REFRESH_REUSE_GRACE_SECONDS;

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { seconds: DEFAULT_REFRESH_REUSE_GRACE_SECONDS, warning: null };
  }

  const parsed = parseNonNegativeInt(raw);

  if (parsed === null) {
    return {
      seconds: DEFAULT_REFRESH_REUSE_GRACE_SECONDS,
      warning:
        `REFRESH_REUSE_GRACE_SECONDS is not a non-negative integer (${raw}): ` +
        `falling back to ${DEFAULT_REFRESH_REUSE_GRACE_SECONDS} s — ` +
        'set it to 0 if the window is meant to be off',
    };
  }

  if (parsed > MAX_REFRESH_REUSE_GRACE_SECONDS) {
    return {
      seconds: MAX_REFRESH_REUSE_GRACE_SECONDS,
      warning:
        `REFRESH_REUSE_GRACE_SECONDS ${parsed} s exceeds the ` +
        `${MAX_REFRESH_REUSE_GRACE_SECONDS} s ceiling and was clamped to it: ` +
        'a burned refresh token stays redeemable for that long',
    };
  }

  return { seconds: parsed, warning: null };
};
