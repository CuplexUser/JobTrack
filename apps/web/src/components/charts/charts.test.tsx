/**
 * The charts are hand-drawn SVG, so nothing but a render catches a broken path or a
 * divide-by-zero — there is no library underneath to have been tested already.
 *
 * What these assert is mostly the accessible text, which is deliberate: a chart nobody can
 * read out loud is a chart that has to be *looked at* to be checked, and the `aria-label`
 * is the one part of an SVG that says in words what the picture claims.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarSeries } from './BarSeries.js';
import { Funnel } from './Funnel.js';
import { Sparkline } from './Sparkline.js';

describe('Funnel', () => {
  const stages = [
    { status: 'applied' as const, count: 40, conversion: null },
    { status: 'screening' as const, count: 10, conversion: 0.25 },
    { status: 'interview' as const, count: 4, conversion: 0.4 },
    { status: 'offer' as const, count: 1, conversion: 0.25 },
  ];

  it('shows each stage with its count and its conversion from the stage above', () => {
    render(<Funnel stages={stages} />);

    expect(screen.getByText('40')).toBeDefined();
    expect(screen.getByText('40% of previous')).toBeDefined();
    // 10 of 40, then 1 of 4 — the same ratio twice over, at different scales.
    expect(screen.getAllByText('25% of previous')).toHaveLength(2);
    // The first stage has nothing above it, so it claims no conversion.
    expect(screen.getAllByText(/% of previous/)).toHaveLength(3);
  });

  it('survives an empty pipeline without dividing by zero', () => {
    const empty = stages.map((stage) => ({ ...stage, count: 0, conversion: null }));
    render(<Funnel stages={empty} />);

    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(screen.queryByText(/% of previous/)).toBeNull();
  });
});

describe('BarSeries', () => {
  const points = [
    { year: 2026, month: 6, count: 3 },
    { year: 2026, month: 7, count: 0 },
    { year: 2026, month: 8, count: 12 },
  ];

  it('describes the whole series in words for a reader who cannot see it', () => {
    render(<BarSeries points={points} />);

    const chart = screen.getByRole('img');
    expect(chart.getAttribute('aria-label')).toContain('Jun 2026 to Aug 2026');
    expect(chart.getAttribute('aria-label')).toContain('Peak 12');
    expect(screen.getByText('15 applications over 3 months')).toBeDefined();
  });

  it('renders nothing at all rather than an empty frame', () => {
    const { container } = render(<BarSeries points={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not divide by zero when no month has any applications', () => {
    const none = points.map((point) => ({ ...point, count: 0 }));
    render(<BarSeries points={none} />);
    expect(screen.getByText('0 applications over 3 months')).toBeDefined();
  });
});

describe('Sparkline', () => {
  it('needs at least two points to have a shape', () => {
    const { container } = render(<Sparkline values={[4]} label="one month" />);
    expect(container.firstChild).toBeNull();
  });

  it('draws a line whose points stay inside the viewBox', () => {
    render(<Sparkline values={[0, 5, 2, 9]} label="four months" />);

    const points = screen.getByRole('img').querySelector('polyline')!.getAttribute('points')!;
    const coordinates = points.split(' ').map((pair) => pair.split(',').map(Number));
    expect(coordinates).toHaveLength(4);
    expect(coordinates.every(([x, y]) => x! >= 0 && x! <= 100 && y! >= 0 && y! <= 100)).toBe(true);
    // The largest value sits on the top edge; zero sits on the bottom one.
    expect(coordinates[3]![1]).toBe(0);
    expect(coordinates[0]![1]).toBe(100);
  });

  it('does not divide by zero when every value is zero', () => {
    render(<Sparkline values={[0, 0, 0]} label="quiet" />);
    const points = screen.getByRole('img').querySelector('polyline')!.getAttribute('points')!;
    expect(points).not.toContain('NaN');
  });
});
