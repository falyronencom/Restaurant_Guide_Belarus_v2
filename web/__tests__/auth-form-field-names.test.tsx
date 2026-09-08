/**
 * Auth form field names — the markup side of the form ↔ Server Action seam.
 *
 * Every auth form submits as a native FormData: the browser collects the
 * `name` attributes of the rendered inputs, and the action reads them back by
 * string key (`formData.get('password')`). Nothing type-checks that pair. It
 * is two string literals in two files that must agree, and TypeScript sees a
 * `string` on both sides.
 *
 * Honesty-audit boundary (2026-09-08). Before this file the seam was pinned on
 * exactly ONE side. Component tests type into fields BY LABEL and mock the
 * action; action tests build their OWN FormData. So all three renames the
 * pilot tried — M47 (`code`→`otp` in VerifyEmailForm), M48 (`password`→`pass`
 * in LoginForm), M49 (hidden `returnTo`→`return_to`) — kept the whole suite
 * green, while login and email confirmation would have broken in production
 * behind a fully green gate. The control M54 (the same rename on the ACTION
 * side, `formData.get('code')`) did go red: one side, not both.
 *
 * `returnTo` carries more than convenience — it is the value the page has
 * already guarded against open redirects. When the attribute drifts, the field
 * does not error: it silently stops arriving and the action falls back to its
 * default.
 *
 * THE INVARIANT, for whoever adds the next form. Each case compares the WHOLE
 * set of names, never membership. `toContain` would catch a rename but not a
 * DISAPPEARANCE — and a vanished hidden `returnTo` is the failure this file
 * exists for. A new auth form with no case here breaks the property silently:
 * add its case together with the form.
 *
 * Deliberately out of scope: `name="search"` in CatalogSearch / HeroSearch —
 * a GET query string, not an auth Server Action seam.
 */
import { render } from '@testing-library/react';

jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => mockAuth,
}));
jest.mock('@/lib/auth/actions', () => ({
  forgotPasswordAction: jest.fn(),
  loginAction: jest.fn(),
  registerAction: jest.fn(),
  resendVerificationCodeAction: jest.fn(),
  resetPasswordAction: jest.fn(),
  startYandexLogin: jest.fn(),
  verifyEmailCodeAction: jest.fn(),
}));

import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { LoginForm } from '@/components/auth/LoginForm';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { VerifyEmailForm } from '@/components/auth/VerifyEmailForm';

/*
 * One context object for the whole file — useAuth must return a STABLE value:
 * LoginForm's success effect lists `applySession` in its deps, and a fresh
 * object per render would re-run it on every commit. `status: 'authenticated'`
 * is load-bearing for VerifyEmailForm, which renders the login invite (no
 * fields at all) for an anonymous visitor.
 */
const mockAuth = {
  status: 'authenticated' as const,
  user: null,
  isAuthenticated: true,
  requestLogin: jest.fn(),
  logout: jest.fn(),
  loginError: null,
  applySession: jest.fn(),
  markAnonymous: jest.fn(),
};

/** Every `name` the browser would put into the submitted FormData, sorted. */
function fieldNames(container: HTMLElement): Array<string | null> {
  return Array.from(container.querySelectorAll('[name]'))
    .map((el) => el.getAttribute('name'))
    .sort();
}

it('ForgotPasswordForm posts exactly one field: email', () => {
  const { container } = render(<ForgotPasswordForm />);

  expect(fieldNames(container)).toEqual(['email'].sort());
});

it('LoginForm posts exactly returnTo, email and password', () => {
  const { container } = render(<LoginForm returnTo="/minsk/restorany" />);

  expect(fieldNames(container)).toEqual(
    ['returnTo', 'email', 'password'].sort(),
  );
});

it('OAuthButtons posts exactly returnTo to the Yandex action', () => {
  const { container } = render(<OAuthButtons returnTo="/minsk/restorany" />);

  expect(fieldNames(container)).toEqual(['returnTo'].sort());
});

it('RegisterForm posts exactly returnTo, name, email and password', () => {
  const { container } = render(<RegisterForm returnTo="/minsk/restorany" />);

  expect(fieldNames(container)).toEqual(
    ['returnTo', 'name', 'email', 'password'].sort(),
  );
});

it('ResetPasswordForm posts exactly token and password', () => {
  const { container } = render(<ResetPasswordForm token="reset-token-1" />);

  expect(fieldNames(container)).toEqual(['token', 'password'].sort());
});

it('VerifyEmailForm posts exactly code', () => {
  const { container } = render(<VerifyEmailForm />);

  expect(fieldNames(container)).toEqual(['code'].sort());
});
