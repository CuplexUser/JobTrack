/**
 * The charts are hand-drawn SVG, so nothing but a render catches a broken path or a
 * divide-by-zero — there is no library underneath to have been tested already.
 *
 * What these assert is mostly the accessible text, which is deliberate: a chart nobody can
 * read out loud is a chart that has to be *looked at* to be checked, and the `aria-label`
 * is the one part of an SVG that says in words what the picture claims.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BarSeries } from './BarSeries.js';
import { Funnel } from './Funnel.js';
import { Sparkline } from './Sparkline.js';
import { TimeBars } from './TimeBars.js';
import { CalendarHeatmap, shadeLevel } from './CalendarHeatmap.js';
import { RankedBars } from './RankedBars.js';

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

describe('TimeBars', () => {
  const points = [
    { start: '2026-09-14', end: '2026-09-14', label: 'Sep 14', applications: 3, openings: 1 },
    { start: '2026-09-15', end: '2026-09-15', label: 'Sep 15', applications: 0, openings: 0 },
  ];

  it('names every bucket with both counts, and totals them', () => {
    render(<TimeBars points={points} />);
    expect(screen.getByRole('button', { name: 'Sep 14: 3 applications, 1 opening saved' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sep 15: 0 applications, 0 openings saved' })).toBeDefined();
    expect(screen.getByText('3 applications and 1 opening saved')).toBeDefined();
    expect(screen.getByRole('group').getAttribute('aria-label')).toContain('Peak 3');
  });

  it('hands the picked bucket back', () => {
    const onSelect = vi.fn();
    render(<TimeBars points={points} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^Sep 15/ }));
    expect(onSelect).toHaveBeenCalledWith(points[1]);
  });

  it('renders nothing for no buckets', () => {
    const { container } = render(<TimeBars points={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('CalendarHeatmap', () => {
  const days = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-09-${String(7 + i).padStart(2, '0')}`,
    count: i === 8 ? 4 : i === 9 ? 1 : 0,
  }));

  it('labels each day and leads with the busiest', () => {
    render(<CalendarHeatmap days={days} />);
    expect(screen.getAllByRole('button')).toHaveLength(14);
    expect(screen.getByRole('button', { name: 'Sep 15, 2026: 4 applications' })).toBeDefined();
    expect(screen.getByText('Busiest day: Sep 15, 2026: 4 applications')).toBeDefined();
  });

  it('hands the picked day back', () => {
    const onSelect = vi.fn();
    render(<CalendarHeatmap days={days} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^Sep 16, 2026/ }));
    expect(onSelect).toHaveBeenCalledWith('2026-09-16');
  });

  it('gives the busiest day the darkest shade and zero none', () => {
    expect(shadeLevel(0, 4)).toBe(-1);
    expect(shadeLevel(4, 4)).toBe(3);
    expect(shadeLevel(1, 1)).toBe(3);
    expect(shadeLevel(1, 4)).toBe(0);
  });
});

describe('RankedBars', () => {
  it('links rows a filter can reproduce and leaves the rest as text', () => {
    render(
      <MemoryRouter>
        <RankedBars
          title="By location"
          rows={[
            { key: 'stockholm', label: 'Stockholm', count: 3, share: 0.75, href: '/applications?location=Stockholm' },
            { key: '__unspecified', label: 'Unspecified', count: 1, share: 0.25, href: null },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Stockholm' }).getAttribute('href')).toBe('/applications?location=Stockholm');
    expect(screen.queryByRole('link', { name: 'Unspecified' })).toBeNull();
    expect(screen.getByText('3 · 75%')).toBeDefined();
    expect(screen.getByRole('list').getAttribute('aria-label')).toBe('By location: Stockholm 3, Unspecified 1');
  });
});
