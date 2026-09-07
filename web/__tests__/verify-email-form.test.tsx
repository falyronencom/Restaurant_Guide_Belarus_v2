/**
 * VerifyEmailForm island — auth-aware rendering (anonymous invite vs form),
 * the React-19 code echo via defaultValue, the resend note, and the two
 * terminal states: verify success and the graceful EMAIL_ALREADY_VERIFIED
 * (from EITHER action). useAuth and the Server Actions are mocked (the actions'
 * own contract lives in auth-verify-email-action.test.ts).
 *
 * Honesty-audit boundary (2026-09-07): the two files do NOT meet. This one types
 * into the field by label and mocks the action; the action test builds its own
 * FormData carrying `code`. The `name` attribute that joins them is asserted by
 * nothing — renaming it (mutation M47; M48/M49 for LoginForm) keeps all 481 tests
 * green while the form stops submitting anything the action reads.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockVerifyAction = jest.fn();
const mockResendAction = jest.fn();
let mockStatus: 'loading' | 'authenticated' | 'anonymous';

jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ status: mockStatus }),
}));
jest.mock('@/lib/auth/actions', () => ({
  verifyEmailCodeAction: (...args: unknown[]) => mockVerifyAction(...args),
  resendVerificationCodeAction: (...args: unknown[]) => mockResendAction(...args),
}));

import { VerifyEmailForm } from '@/components/auth/VerifyEmailForm';

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = 'authenticated';
});

describe('VerifyEmailForm — auth awareness', () => {
  it('anonymous visitor gets the login invite with returnTo back to this screen', () => {
    mockStatus = 'anonymous';
    render(<VerifyEmailForm />);

    expect(screen.getByText('Войдите, чтобы подтвердить почту.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fverify-email',
    );
    expect(screen.queryByLabelText('Код из письма')).not.toBeInTheDocument();
  });

  it('renders the form for an authenticated user', () => {
    render(<VerifyEmailForm />);

    expect(screen.getByLabelText('Код из письма')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подтвердить' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Отправить код повторно' }),
    ).toBeInTheDocument();
  });

  it('renders the form optimistically while the context hydrates', () => {
    mockStatus = 'loading';
    render(<VerifyEmailForm />);

    expect(screen.getByLabelText('Код из письма')).toBeInTheDocument();
  });
});

describe('VerifyEmailForm — verify flow', () => {
  it('shows the error and echoes the entered code via defaultValue after a failed submit', async () => {
    mockVerifyAction.mockResolvedValue({
      ok: false,
      code: 'INVALID_CODE',
      message: 'Неверный код. Проверьте код из письма и попробуйте ещё раз.',
      values: { code: '111111' },
    });
    const user = userEvent.setup();
    render(<VerifyEmailForm />);

    await user.type(screen.getByLabelText('Код из письма'), '111111');
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() =>
      expect(
        screen.getByText('Неверный код. Проверьте код из письма и попробуйте ещё раз.'),
      ).toBeInTheDocument(),
    );
    // React 19 reset the uncontrolled input; the echo repopulates it.
    expect(screen.getByLabelText('Код из письма')).toHaveValue('111111');
  });

  it('replaces the form with the confirmation on success', async () => {
    mockVerifyAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<VerifyEmailForm />);

    await user.type(screen.getByLabelText('Код из письма'), '123456');
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() =>
      expect(screen.getByText('Почта подтверждена.')).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/');
    expect(screen.queryByLabelText('Код из письма')).not.toBeInTheDocument();
  });

  it('renders EMAIL_ALREADY_VERIFIED from verify as a graceful terminal, not an error', async () => {
    mockVerifyAction.mockResolvedValue({
      ok: false,
      code: 'EMAIL_ALREADY_VERIFIED',
      message: 'Почта уже подтверждена.',
    });
    const user = userEvent.setup();
    render(<VerifyEmailForm />);

    await user.type(screen.getByLabelText('Код из письма'), '123456');
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() =>
      expect(screen.getByText('Почта уже подтверждена.')).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Код из письма')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'На главную' })).toBeInTheDocument();
  });
});

describe('VerifyEmailForm — resend flow', () => {
  it('shows the sent note and keeps the code form on resend success', async () => {
    mockResendAction.mockResolvedValue({
      ok: true,
      message: 'Мы отправили новый код на вашу почту.',
    });
    const user = userEvent.setup();
    render(<VerifyEmailForm />);

    await user.click(screen.getByRole('button', { name: 'Отправить код повторно' }));

    await waitFor(() =>
      expect(screen.getByText('Мы отправили новый код на вашу почту.')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Код из письма')).toBeInTheDocument();
  });

  it('renders EMAIL_ALREADY_VERIFIED from resend as the same graceful terminal', async () => {
    mockResendAction.mockResolvedValue({
      ok: false,
      code: 'EMAIL_ALREADY_VERIFIED',
      message: 'Почта уже подтверждена.',
    });
    const user = userEvent.setup();
    render(<VerifyEmailForm />);

    await user.click(screen.getByRole('button', { name: 'Отправить код повторно' }));

    await waitFor(() =>
      expect(screen.getByText('Почта уже подтверждена.')).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Код из письма')).not.toBeInTheDocument();
  });
});
