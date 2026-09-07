/**
 * MenuBlock (Brief 4 / CAT-C-2.7) — quality-aware menu presentation.
 *
 * MenuBlock is a SYNC Server Component (plain prop-taking, no top-level await),
 * so we render it directly: render(<MenuBlock {...props} />). It takes its data
 * as props (menuItems / pdfFallbacks / establishmentName) — there is no API
 * client to mock here; the shape contract lives entirely in the props → DOM /
 * JSON-LD mapping.
 *
 * Shape-contract cases:
 *   1. 'clean' item     → NO "уточнить" indicator; IS in the Menu JSON-LD.
 *   2. 'needs_caution'  → "уточнить" indicator shown; EXCLUDED from JSON-LD.
 *   3. Empty items + PDF (file_type='pdf', type='menu') → PDF fallback link.
 *   4. Empty items + no PDF → graceful empty-state «Меню пока не загружено.»
 *
 * Honesty-audit boundary (2026-09-07): the PRICE is asserted nowhere — neither
 * the rendered «12,50 BYN» row nor the JSON-LD offer. Rendering every fractional
 * price as «—» (mutation M52) and swapping priceCurrency BYN→USD (M53) both keep
 * all 481 tests green.
 */
import { render, screen } from '@testing-library/react';

import { MenuBlock } from '@/components/establishment/MenuBlock';
import type { PublicMenuItem, PublicMedia } from '@/lib/api/types';

const item = (over: Partial<PublicMenuItem>): PublicMenuItem => ({
  id: 'i1',
  establishment_id: 'e1',
  item_name: 'Борщ',
  price_byn: 12.5,
  category_raw: 'Супы',
  position: 0,
  quality_tier: 'clean',
  ...over,
});

const pdf = (over: Partial<PublicMedia>): PublicMedia => ({
  id: 'm1',
  url: 'https://cdn.example.com/menu.pdf',
  file_type: 'pdf',
  type: 'menu',
  position: 0,
  caption: null,
  ...over,
});

// Parse the single Menu JSON-LD <script> emitted by the block.
const parseJsonLd = (container: HTMLElement) => {
  const el = container.querySelector('script[type="application/ld+json"]');
  return el ? JSON.parse(el.textContent ?? '') : null;
};

// Flatten hasMenuSection[].hasMenuItem[].name → string[] for membership checks.
const jsonLdItemNames = (jsonLd: ReturnType<typeof JSON.parse>): string[] =>
  (jsonLd?.hasMenuSection ?? []).flatMap(
    (s: { hasMenuItem?: { name: string }[] }) =>
      (s.hasMenuItem ?? []).map((mi) => mi.name),
  );

describe('MenuBlock — quality-tier presentation', () => {
  it("'clean' item: no 'уточнить' indicator and IS included in the Menu JSON-LD", () => {
    const { container } = render(
      <MenuBlock
        menuItems={[item({ id: 'c1', item_name: 'Цезарь', quality_tier: 'clean' })]}
        menuPhotos={[]}
        pdfFallbacks={[]}
        establishmentName='Васильки'
      />,
    );

    // No caution indicator anywhere for a clean-only block.
    expect(screen.queryByText('уточнить')).not.toBeInTheDocument();
    // The item itself is still rendered.
    expect(screen.getByText('Цезарь')).toBeInTheDocument();

    // Clean item IS propagated to structured data.
    const jsonLd = parseJsonLd(container);
    expect(jsonLd).not.toBeNull();
    expect(jsonLd['@type']).toBe('Menu');
    expect(jsonLdItemNames(jsonLd)).toContain('Цезарь');
  });

  it("'needs_caution' item: shows 'уточнить' indicator and is EXCLUDED from the JSON-LD", () => {
    const { container } = render(
      <MenuBlock
        menuItems={[
          item({ id: 'g1', item_name: 'Цезарь', quality_tier: 'clean' }),
          item({
            id: 'g2',
            item_name: 'Стейк рибай',
            quality_tier: 'needs_caution',
          }),
        ]}
        menuPhotos={[]}
        pdfFallbacks={[]}
        establishmentName='Васильки'
      />,
    );

    // Caution indicator is shown (exactly once — only the caution item).
    expect(screen.getByText('уточнить')).toBeInTheDocument();
    // Both items are visibly listed (caution does not block display).
    expect(screen.getByText('Стейк рибай')).toBeInTheDocument();

    // JSON-LD includes the clean item but NOT the needs_caution one.
    const names = jsonLdItemNames(parseJsonLd(container));
    expect(names).toContain('Цезарь');
    expect(names).not.toContain('Стейк рибай');
  });
});

describe('MenuBlock — empty-state / PDF fallback', () => {
  it('empty items + a PDF (file_type=pdf, type=menu): renders a link to the PDF, no JSON-LD', () => {
    const { container } = render(
      <MenuBlock
        menuItems={[]}
        menuPhotos={[]}
        pdfFallbacks={[
          pdf({ url: 'https://cdn.example.com/vasilki-menu.pdf', caption: null }),
        ]}
        establishmentName='Васильки'
      />,
    );

    // PDF download: a «Скачать PDF» button linking to the PDF url.
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://cdn.example.com/vasilki-menu.pdf');
    expect(link).toHaveTextContent('Скачать PDF');

    // No parsed items → no Menu JSON-LD emitted.
    expect(parseJsonLd(container)).toBeNull();
  });

  it('empty items + two PDFs: numbers the buttons «Меню 1 / Меню 2» so they are distinguishable', () => {
    render(
      <MenuBlock
        menuItems={[]}
        menuPhotos={[]}
        pdfFallbacks={[
          pdf({ id: 'm1', url: 'https://cdn.example.com/menu-1.pdf' }),
          pdf({ id: 'm2', url: 'https://cdn.example.com/menu-2.pdf' }),
        ]}
        establishmentName='Васильки'
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(screen.getByText('Меню 1')).toBeInTheDocument();
    expect(screen.getByText('Меню 2')).toBeInTheDocument();
    // The ambiguous generic label is gone once there is more than one file.
    expect(screen.queryByText('Скачать PDF')).not.toBeInTheDocument();
    expect(links[0]).toHaveAttribute('href', 'https://cdn.example.com/menu-1.pdf');
    expect(links[1]).toHaveAttribute('href', 'https://cdn.example.com/menu-2.pdf');
  });

  it('empty items + no PDF: renders the graceful empty-state, no link, no JSON-LD', () => {
    const { container } = render(
      <MenuBlock
        menuItems={[]}
        menuPhotos={[]}
        pdfFallbacks={[]}
        establishmentName='Васильки'
      />,
    );

    expect(screen.getByText('Меню пока не загружено.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(parseJsonLd(container)).toBeNull();
  });
});
