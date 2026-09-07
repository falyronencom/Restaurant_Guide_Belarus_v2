/**
 * FOUNDATIONAL PATTERN — testing a Client island ('use client').
 *
 * Client Components render directly under React Testing Library (no async
 * workaround needed). render() flushes the mount useEffect via act(), so the
 * badge's post-mount state is asserted synchronously.
 *
 * computeOpenStatus is a pure helper. Honesty audit 2026-09-07: it is NOT
 * separately unit-tested — nothing in web/__tests__ asserts its output, and its
 * overnight-rollover branch is executed by no test at all (breaking it leaves
 * all 481 tests green, mutation M45). Do not read the mock below as "covered
 * elsewhere": it narrows THIS file to the island. We mock it so
 * the badge's render branches are deterministic and independent of wall-clock
 * time — the island's own job (map computed status → DOM) is what's under test.
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
