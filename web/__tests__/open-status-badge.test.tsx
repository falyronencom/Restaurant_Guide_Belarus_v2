/**
 * FOUNDATIONAL PATTERN — testing a Client island ('use client').
 *
 * Client Components render directly under React Testing Library (no async
 * workaround needed). render() flushes the mount useEffect via act(), so the
 * badge's post-mount state is asserted synchronously.
 *
 * computeOpenStatus is a pure helper, unit-tested in its own file since
 * 2026-09-08: __tests__/working-hours.test.ts asserts the parser and the
 * verdict, the overnight-rollover branch included. Until then that branch was
 * executed by no test at all — honesty audit, pilot mutation M45 broke it and
 * left all 481 tests green. So the mock below is not a coverage gap: it narrows
 * THIS file to the island, keeping the badge's render branches deterministic
 * and independent of wall-clock time — the island's own job (map computed
 * status → DOM) is what's under test.
 */
import { render, screen } from '@testing-library/react';

import { OpenStatusBadge } from '@/components/catalog/OpenStatusBadge';
import { computeOpenStatus } from '@/lib/working-hours';

jest.mock('@/lib/working-hours', () => ({
  computeOpenStatus: jest.fn(),
}));

describe('OpenStatusBadge — client island', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the open state with a closing time after mount', () => {
    (computeOpenStatus as jest.Mock).mockReturnValue({
      isOpen: true,
      closingTime: '22:00',
      source: 'workingHours',
    });

    const { container } = render(
      <OpenStatusBadge workingHours={{}} status="active" />,
    );

    expect(screen.getByText('Открыто')).toBeInTheDocument();
    expect(container).toHaveTextContent('Открыто · до 22:00');
  });

  it('renders the closed state without a closing time', () => {
    (computeOpenStatus as jest.Mock).mockReturnValue({
      isOpen: false,
      closingTime: null,
      source: 'workingHours',
    });

    const { container } = render(
      <OpenStatusBadge workingHours={{}} status="inactive" />,
    );

    expect(screen.getByText('Закрыто')).toBeInTheDocument();
    expect(screen.queryByText('Открыто')).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('до');
  });
});
