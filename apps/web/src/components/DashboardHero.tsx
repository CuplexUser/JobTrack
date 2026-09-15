/**
 * The top of the dashboard: a greeting, what is waiting today in one sentence, the four
 * figures that say where the search stands, and the search itself drawn as a landscape.
 *
 * The figures used to be four separate cards of different heights; set as type inside one
 * band they line up by construction, and the landscape underneath is the one decorative
 * thing on the page.
 */

import { Link } from 'react-router-dom';
import { Button, Flex, Typography } from 'antd';
import { BarChartOutlined, PlusOutlined } from '@ant-design/icons';
import { monthName, toPeriod, todayDateOnly } from '@jobtrack/shared';
import type { DashboardResponse } from '../api/client.js';
import { Stars, Terrain } from './charts/Terrain.js';

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What is waiting, as a sentence a person would say, most pressing first. */
export function waitingSentence(data: Pick<DashboardResponse, 'followUps' | 'stale' | 'reconnect'>): string {
  const parts: string[] = [];
  if (data.followUps.length > 0) {
    parts.push(`${plural(data.followUps.length, 'follow-up is', 'follow-ups are')} due`);
  }
  if (data.stale.length > 0) {
    parts.push(`${plural(data.stale.length, 'application has', 'applications have')} gone quiet`);
  }
  if (data.reconnect.length > 0) {
    parts.push(`${plural(data.reconnect.length, 'person is', 'people are')} due a reconnect`);
  }
  if (parts.length === 0) return 'Nothing is waiting on you today.';
  const sentence = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function Figure({ value, label, note, accent }: { value: string; label: string; note?: string; accent?: boolean }) {
  return (
    <div className="jt-hero-figure">
      <div className={`jt-hero-value${accent ? ' jt-hero-value-accent' : ''}`}>{value}</div>
      <div className="jt-hero-label">{label}</div>
      {note && <div className="jt-hero-note">{note}</div>}
    </div>
  );
}

export interface DashboardHeroProps {
  data: DashboardResponse;
  onNewApplication: () => void;
}

export function DashboardHero({ data, onNewApplication }: DashboardHeroProps) {
  const now = new Date();
  const period = toPeriod(todayDateOnly(now));
  const { stats, volume } = data;

  const previousMonths = volume.slice(-13, -1);
  const monthlyAverage =
    previousMonths.length > 0 ? previousMonths.reduce((sum, point) => sum + point.count, 0) / previousMonths.length : 0;
  const againstAverage = stats.thisMonth - monthlyAverage;

  return (
    <section className="jt-hero" aria-label="Where your search stands">
      <Stars />
      <div className="jt-hero-body">
        <div className="jt-hero-intro">
          <Typography.Text type="secondary">
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Typography.Text>
          <h1 className="jt-hero-title">{greeting(now)}</h1>
          <p className="jt-hero-sentence">{waitingSentence(data)}</p>
          <Flex gap={8} wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={onNewApplication}>
              New application
            </Button>
            <Link to="/statistics">
              <Button icon={<BarChartOutlined />}>Statistics</Button>
            </Link>
          </Flex>
        </div>

        <div className="jt-hero-figures">
          <Figure value={String(stats.total)} label="applications in total" />
          <Figure value={String(stats.active)} label="still active" accent />
          <Figure
            value={String(stats.thisMonth)}
            label={`in ${monthName(period.month)}`}
            note={
              monthlyAverage === 0
                ? 'first month on record'
                : `${againstAverage >= 0 ? '+' : ''}${againstAverage.toFixed(1)} vs your monthly average`
            }
          />
          <Figure
            value={`${Math.round(stats.responseRate * 100)}%`}
            label="got a reply"
            note="anything past applied counts"
          />
        </div>
      </div>
      <Terrain points={volume} />
    </section>
  );
}
