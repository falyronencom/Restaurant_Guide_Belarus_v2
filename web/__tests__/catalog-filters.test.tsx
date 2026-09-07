/**
 * Catalog filter shelf (Phase A) — first tests for the filter surface.
 *
 * Three concerns, same async-RSC pattern as city-page.test.tsx (mock the API
 * client boundary @/lib/api/endpoints/*, invoke the async component /
 * generateMetadata as a function):
 *
 *   1. URL searchParam → getCatalog fetch-param mapping (multi-value comma-join
 *      for cuisine/priceRange, single bucket for hours, soft-ignore unknown).
 *   2. SEO — hasAnyFilter → noindex+follow + clean canonical (CAT-C-2.3),
 *      pagination stays indexable.
 *   3. FilterShelf island — user toggle → URL round-trip (OR-within-group
 *      comma-join, select-all short-circuit, page reset, single-select hours).
 *
 * Honesty-audit boundary (2026-09-07): `features` is absent from all three
 * concerns. The page can stop forwarding it to getCatalog (mutation M19) and the
 * shelf can collapse it when all are selected — treating an AND facet as OR
 * (M29) — with all 19 tests green. `expect.objectContaining` cannot see a
 * missing key, so concern 1 pins only the keys it names.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CategoryPage, {
  generateMetadata,
} from '@/app/(public)/[city]/[category]/page';
import { getCatalog } from '@/lib/api/endpoints/establishments';
import {
  getMetadata,
  validateCategorySlug,
  validateCitySlug,
} from '@/lib/api/endpoints/metadata';
import { FilterShelf } from '@/components/catalog/FilterShelf';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: jest.fn(() => ({ push: mockPush })),
}));

// Mock boundary: the typed API client. Bare jest.fn()s, return values set per
// test (avoids the resetMocks factory-wipe trap — see feedback_jest_resetmocks).
jest.mock('@/lib/api/endpoints/establishments', () => ({
  getCatalog: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/metadata', () => ({
  getMetadata: jest.fn(),
  validateCitySlug: jest.fn(),
  validateCategorySlug: jest.fn(),
}));

const META = {
  cities: [{ slug: 'minsk', name: 'Минск' }],
  categories: [{ slug: 'restorany', name: 'Рестораны' }],
  cuisines: [
    { slug: 'italian', name: 'Итальянская' },
    { slug: 'asian', name: 'Азиатская' },
    { slug: 'georgian', name: 'Грузинская' },
  ],
};

const EMPTY_CATALOG = {
  establishments: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

const P = () => Promise.resolve({ city: 'minsk', category: 'restorany' });
const SP = (o: Record<string, string | string[] | undefined>) =>
  Promise.resolve(o);

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue(META);
  (validateCitySlug as jest.Mock).mockResolvedValue(true);
  (validateCategorySlug as jest.Mock).mockResolvedValue(true);
  (getCatalog as jest.Mock).mockResolvedValue(EMPTY_CATALOG);
});

// ===========================================================================
// 1. searchParam → getCatalog mapping
// ===========================================================================

describe('CategoryPage — searchParam → getCatalog mapping', () => {
  it('maps comma-joined multi-value cuisine/priceRange + single hours bucket', async () => {
    await CategoryPage({
      params: P(),
      searchParams: SP({
        cuisine: 'italian,asian',
        priceRange: '$,$$',
        hours: 'until_22',
      }),
    });

    expect(getCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        cuisines: ['italian', 'asian'],
        priceRange: ['$', '$$'],
        hours_filter: 'until_22',
      }),
    );
  });

  it('soft-ignores an unknown hours bucket (no 422 on the LIST surface)', async () => {
    await CategoryPage({ params: P(), searchParams: SP({ hours: 'garbage' }) });

    expect(getCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ hours_filter: undefined }),
    );
  });

  it('passes undefined (not empty arrays) when no facets are selected', async () => {
    await CategoryPage({ params: P(), searchParams: SP({}) });

    const arg = (getCatalog as jest.Mock).mock.calls[0][0];
    expect(arg.cuisines).toBeUndefined();
    expect(arg.priceRange).toBeUndefined();
    expect(arg.hours_filter).toBeUndefined();
  });
});

// ===========================================================================
// 2. SEO — noindex / canonical (CAT-C-2.3)
// ===========================================================================

describe('generateMetadata — filter-aware noindex + canonical', () => {
  it('noindex+follow with clean canonical when a facet is active', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ cuisine: 'italian' }),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe('/minsk/restorany');
  });

  it('noindex when only the hours bucket is active', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ hours: 'until_22' }),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('does NOT noindex a paginated-only URL — pages stay indexable', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ page: '2' }),
    });
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe('/minsk/restorany');
  });

  it('does NOT noindex the clean catalog URL', async () => {
    const meta = await generateMetadata({ params: P(), searchParams: SP({}) });
    expect(meta.robots).toBeUndefined();
  });

  it('does NOT noindex when the hours value is unknown (not a real filter)', async () => {
    const meta = await generateMetadata({
      params: P(),
      searchParams: SP({ hours: 'garbage' }),
    });
    expect(meta.robots).toBeUndefined();
  });
});

// ===========================================================================
// 3. FilterShelf island — toggle → URL
// ===========================================================================

describe('FilterShelf — toggle → URL round-trip', () => {
  const baseProps = {
    citySlug: 'minsk',
    categories: [{ slug: 'restorany', name: 'Рестораны' }],
    basePath: '/minsk/restorany',
    cuisineOptions: [
      { value: 'italian', label: 'Итальянская' },
      { value: 'asian', label: 'Азиатская' },
    ],
  };

  const pushedQuery = () => {
    const url = mockPush.mock.calls[0][0] as string;
    return new URLSearchParams(url.split('?')[1] ?? '');
  };

  it('adds a price value as a comma-joined param and resets page', async () => {
    render(
      <FilterShelf
        {...baseProps}
        searchParams={{ page: '3' }}
        selected={{ cuisines: [], priceRange: [], features: [], hours: undefined }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /до 20 руб/ }));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const q = pushedQuery();
    expect(q.get('priceRange')).toBe('$');
    expect(q.get('page')).toBeNull();
  });

  it('appends a second value to the same group (OR-within-group, comma-join)', async () => {
    render(
      <FilterShelf
        {...baseProps}
        searchParams={{ priceRange: '$' }}
        selected={{ cuisines: [], priceRange: ['$'], features: [], hours: undefined }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /до 50 руб/ }));

    expect(pushedQuery().get('priceRange')).toBe('$,$$');
  });

  it('omits the param when every option becomes selected (select-all short-circuit)', async () => {
    render(
      <FilterShelf
        {...baseProps}
        searchParams={{ priceRange: '$,$$' }}
        selected={{ cuisines: [], priceRange: ['$', '$$'], features: [], hours: undefined }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /более 50 руб/ }));

    // All three selected → no priceRange param at all (clean URL).
    expect(mockPush.mock.calls[0][0]).toBe('/minsk/restorany');
  });

  it('single-selects an hours bucket, then clears it on re-click', async () => {
    const { rerender } = render(
      <FilterShelf
        {...baseProps}
        searchParams={{}}
        selected={{ cuisines: [], priceRange: [], features: [], hours: undefined }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'До 22:00' }));
    expect(pushedQuery().get('hours')).toBe('until_22');

    mockPush.mockClear();
    rerender(
      <FilterShelf
        {...baseProps}
        searchParams={{ hours: 'until_22' }}
        selected={{ cuisines: [], priceRange: [], features: [], hours: 'until_22' }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'До 22:00' }));
    expect(mockPush.mock.calls[0][0]).toBe('/minsk/restorany');
  });

  it('renders a tile per cuisine option supplied from metadata', () => {
    render(
      <FilterShelf
        {...baseProps}
        searchParams={{}}
        selected={{ cuisines: [], priceRange: [], features: [], hours: undefined }}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Итальянская' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Азиатская' }),
    ).toBeInTheDocument();
  });
});

// ===========================================================================
// 4. FilterShelf — controlled / batch mode (mobile drawer)
// ===========================================================================

describe('FilterShelf — controlled/batch mode', () => {
  const baseProps = {
    citySlug: 'minsk',
    categories: [{ slug: 'restorany', name: 'Рестораны' }],
    basePath: '/minsk/restorany',
    searchParams: {},
    cuisineOptions: [
      { value: 'italian', label: 'Итальянская' },
      { value: 'asian', label: 'Азиатская' },
    ],
  };
  const EMPTY = {
    cuisines: [],
    priceRange: [],
    features: [],
    hours: undefined,
  };

  it('toggling a cuisine calls onSelectedChange with the raw array — NO navigation', async () => {
    const onSelectedChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        selected={EMPTY}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Итальянская' }));

    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ cuisines: ['italian'] }),
    );
    expect(mockPush).not.toHaveBeenCalled(); // batch: no per-tap navigation
  });

  it('does NOT collapse when every cuisine becomes selected (raw storage, unlike live)', async () => {
    const onSelectedChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        selected={{ ...EMPTY, cuisines: ['italian'] }}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    // Selecting the 2nd of 2 options → "all". Live mode omits the param; batch
    // mode must keep the full array (collapsing is deferred to «Применить»).
    await userEvent.click(screen.getByRole('button', { name: 'Азиатская' }));

    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ cuisines: ['italian', 'asian'] }),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('re-toggling an active cuisine removes it from the draft', async () => {
    const onSelectedChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        selected={{ ...EMPTY, cuisines: ['italian'] }}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Итальянская' }));

    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ cuisines: [] }),
    );
  });

  it('renders category as a <button> that drives onCategoryChange (not a link)', async () => {
    const onCategoryChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        selected={EMPTY}
        onSelectedChange={jest.fn()}
        onCategoryChange={onCategoryChange}
      />,
    );

    const tile = screen.getByRole('button', { name: /Рестораны/ });
    expect(tile.tagName).toBe('BUTTON'); // batch: category is NOT a SEO <Link>
    await userEvent.click(tile);
    expect(onCategoryChange).toHaveBeenCalledWith('restorany');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('re-tapping the active category clears it (→ undefined)', async () => {
    const onCategoryChange = jest.fn();
    render(
      <FilterShelf
        {...baseProps}
        activeCategorySlug="restorany"
        selected={EMPTY}
        onSelectedChange={jest.fn()}
        onCategoryChange={onCategoryChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Рестораны/ }));
    expect(onCategoryChange).toHaveBeenCalledWith(undefined);
  });

  it('toggles the single hours bucket in the draft, clearing on re-tap', async () => {
    const onSelectedChange = jest.fn();
    const { rerender } = render(
      <FilterShelf
        {...baseProps}
        selected={EMPTY}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'До 22:00' }));
    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 'until_22' }),
    );

    onSelectedChange.mockClear();
    rerender(
      <FilterShelf
        {...baseProps}
        selected={{ ...EMPTY, hours: 'until_22' }}
        onSelectedChange={onSelectedChange}
        onCategoryChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'До 22:00' }));
    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ hours: undefined }),
    );
  });
});
