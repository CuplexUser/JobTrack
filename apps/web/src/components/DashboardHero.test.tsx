import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { waitingSentence } from './DashboardHero.js';
import { Terrain } from './charts/Terrain.js';

const items = (n: number) => Array.from({ length: n }, () => ({}) as never);

describe('waitingSentence', () => {
  it('says so when nothing is waiting', () => {
    expect(waitingSentence({ followUps: [], stale: [], reconnect: [] })).toBe('Nothing is waiting on you today.');
  });

  it('joins what is waiting, most pressing first, with singulars right', () => {
    expect(waitingSentence({ followUps: items(1), stale: items(4), reconnect: items(2) })).toBe(
      '1 follow-up is due, 4 applications have gone quiet and 2 people are due a reconnect.',
    );
    expect(waitingSentence({ followUps: [], stale: items(1), reconnect: [] })).toBe('1 application has gone quiet.');
  });
});

describe('Terrain', () => {
  const months = (counts: number[]) => counts.map((count, i) => ({ year: 2026, month: i + 1, count }));

  it('flags the most recent peak month', () => {
    const { container } = render(<Terrain points={months([1, 5, 2, 5, 0])} />);
    expect(container.textContent).toBe('Peak: 5 in Apr 2026');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('draws no flag for a search with no applications, and nothing for one month', () => {
    expect(render(<Terrain points={months([0, 0, 0])} />).container.textContent).toBe('');
    expect(render(<Terrain points={months([3])} />).container.firstChild).toBeNull();
  });
});
