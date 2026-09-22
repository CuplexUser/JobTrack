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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toPeriod, todayDateOnly } from '@jobtrack/shared';
import type { DashboardResponse } from '../api/client.js';
import { Stars, Terrain } from './charts/Terrain.js';

function greeting(now: Date, t: TFunction<'dashboard'>): string {
  const hour = now.getHours();
  if (hour < 5) return t('greeting.workingLate');
  if (hour < 12) return t('greeting.morning');
  if (hour < 18) return t('greeting.afternoon');
  return t('greeting.evening');
}

/**
 * What is waiting, as a sentence a person would say, most pressing first. `t` is threaded in
 * rather than read from a hook, so this stays a plain, independently testable function — see
 * `DashboardHero.test.tsx`, which calls it with `i18n.getFixedT('en', 'dashboard')`.
 */
export function waitingSentence(
  data: Pick<DashboardResponse, 'followUps' | 'stale' | 'reconnect'>,
  t: TFunction<'dashboard'>,
): string {
  const parts: string[] = [];
  if (data.followUps.length > 0) parts.push(t('waiting.followUps', { count: data.followUps.length }));
  if (data.stale.length > 0) parts.push(t('waiting.stale', { count: data.stale.length }));
  if (data.reconnect.length > 0) parts.push(t('waiting.reconnect', { count: data.reconnect.length }));
  if (parts.length === 0) return t('waiting.nothing');
  const joiner = t('waiting.joiner');
  const sentence = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} ${joiner} ${parts.at(-1)}`;
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
  const { t, i18n } = useTranslation('dashboard');
  const now = new Date();
  const period = toPeriod(todayDateOnly(now));
  const { stats, volume } = data;

  const previousMonths = volume.slice(-13, -1);
  const monthlyAverage =
    previousMonths.length > 0 ? previousMonths.reduce((sum, point) => sum + point.count, 0) / previousMonths.length : 0;
  const againstAverage = stats.thisMonth - monthlyAverage;
  const monthLabel = new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(
    new Date(Date.UTC(period.year, period.month - 1, 1)),
  );

  return (
    <section className="jt-hero" aria-label={t('sectionAriaLabel')}>
      <Stars />
      <div className="jt-hero-body">
        <div className="jt-hero-intro">
          <Typography.Text type="secondary">
            {now.toLocaleDateString(i18n.language, { weekday: 'long', month: 'long', day: 'numeric' })}
          </Typography.Text>
          <h1 className="jt-hero-title">{greeting(now, t)}</h1>
          <p className="jt-hero-sentence">{waitingSentence(data, t)}</p>
          <Flex gap={8} wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={onNewApplication}>
              {t('actions.newApplication')}
            </Button>
            <Link to="/statistics">
              <Button icon={<BarChartOutlined />}>{t('actions.statistics')}</Button>
            </Link>
          </Flex>
        </div>

        <div className="jt-hero-figures">
          <Figure value={String(stats.total)} label={t('figures.total')} />
          <Figure value={String(stats.active)} label={t('figures.active')} accent />
          <Figure
            value={String(stats.thisMonth)}
            label={t('figures.thisMonth', { month: monthLabel })}
            note={
              monthlyAverage === 0
                ? t('figures.firstMonth')
                : t('figures.vsAverage', { sign: againstAverage >= 0 ? '+' : '', value: againstAverage.toFixed(1) })
            }
          />
          <Figure
            value={`${Math.round(stats.responseRate * 100)}%`}
            label={t('figures.responseRate')}
            note={t('figures.responseNote')}
          />
        </div>
      </div>
      <Terrain points={volume} />
    </section>
  );
}
