/**
 * Statistics: how many applications went out, when, and where.
 *
 * The question this page exists for is "what did I send today, this week, this month, and
 * which ones", so the quick windows lead and each is one click from its list. Below them the
 * chosen range is broken down over time, by day on a calendar, and by location, source, work
 * mode, outcome and company, and every application in the range is listed with its links.
 *
 * Like the applications list, the range lives in the URL, so any view is a link.
 */

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Flex,
  Row,
  Segmented,
  Skeleton,
  Space,
  Statistic,
  Switch,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { ArrowDownOutlined, ArrowUpOutlined, ExportOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  STATUS_LABELS,
  WORK_MODE_LABELS,
  addDays,
  endOfMonth,
  startOfIsoWeek,
  startOfMonth,
  todayDateOnly,
  type BreakdownRow,
  type QuickWindow,
} from '@jobtrack/shared';
import { useStatistics } from '../api/hooks.js';
import type { StatisticsResponse } from '../api/client.js';
import { StatusTag } from '../components/StatusTag.js';
import { TimeBars } from '../components/charts/TimeBars.js';
import { CalendarHeatmap } from '../components/charts/CalendarHeatmap.js';
import { RankedBars, type RankedRow } from '../components/charts/RankedBars.js';

type Row = StatisticsResponse['applications'][number];

/** The tiles along the top. "Last week" is left to the range presets, to keep the row short. */
const TILE_WINDOWS = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'last30'] as const;

/**
 * `QuickWindow.label`/`.previousLabel` (packages/shared) are pre-formatted English, used as-is
 * by non-web consumers of the statistics API. `key` is the one stable, language-neutral field,
 * so the tile title and the "against" phrase are looked up from it here instead, the same
 * decoupling used for `FitReason.i18nKey` in `packages/shared/src/fit.ts`.
 */
const QUICK_TITLE_KEYS: Record<QuickWindow['key'], string> = {
  today: 'presets.today',
  yesterday: 'presets.yesterday',
  thisWeek: 'presets.thisWeek',
  lastWeek: 'presets.lastWeek',
  thisMonth: 'presets.thisMonth',
  last30: 'presets.last30Days',
};

const QUICK_PREVIOUS_LABEL_KEYS: Record<QuickWindow['key'], string> = {
  today: 'quick.previousLabel.today',
  yesterday: 'quick.previousLabel.yesterday',
  thisWeek: 'quick.previousLabel.thisWeek',
  lastWeek: 'quick.previousLabel.lastWeek',
  thisMonth: 'quick.previousLabel.thisMonth',
  last30: 'quick.previousLabel.last30',
};

/** Range presets, as calendar days. Weeks start on Monday, the same as the counts. */
function rangePresets(today: string, t: TFunction<'statistics'>): { label: string; from: string; to: string }[] {
  const monday = startOfIsoWeek(today);
  const monthStart = startOfMonth(today);
  const lastMonth = addDays(monthStart, -1);
  return [
    { label: t('presets.today'), from: today, to: today },
    { label: t('presets.yesterday'), from: addDays(today, -1), to: addDays(today, -1) },
    { label: t('presets.thisWeek'), from: monday, to: addDays(monday, 6) },
    { label: t('presets.lastWeek'), from: addDays(monday, -7), to: addDays(monday, -1) },
    { label: t('presets.thisMonth'), from: monthStart, to: endOfMonth(today) },
    { label: t('presets.lastMonth'), from: startOfMonth(lastMonth), to: lastMonth },
    { label: t('presets.last30Days'), from: addDays(today, -29), to: today },
    { label: t('presets.last90Days'), from: addDays(today, -89), to: today },
    { label: t('presets.thisYear'), from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
  ];
}

/** A link into the applications list for a date range plus one more filter. */
function applicationsHref(from: string, to: string, extra: Record<string, string> = {}): string {
  return `/applications?${new URLSearchParams({ ...extra, from, to }).toString()}`;
}

function Delta({ count, previous, against }: { count: number; previous: number; against: string }) {
  const { t } = useTranslation('statistics');
  const change = count - previous;
  if (change === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('delta.same', { against })}
      </Typography.Text>
    );
  }
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {change > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{' '}
      {t(change > 0 ? 'delta.more' : 'delta.fewer', { count: Math.abs(change), against })}
    </Typography.Text>
  );
}

function QuickTile({ quick, onPick, active }: { quick: QuickWindow; onPick: () => void; active: boolean }) {
  const { t } = useTranslation('statistics');
  const title = t(QUICK_TITLE_KEYS[quick.key]);
  const against = t(QUICK_PREVIOUS_LABEL_KEYS[quick.key]);
  return (
    <Card
      size="small"
      hoverable
      onClick={onPick}
      style={active ? { borderColor: 'var(--jt-accent)' } : undefined}
      aria-label={t('quickTile.showAriaLabel', { label: title.toLowerCase(), count: quick.count })}
    >
      <Flex justify="space-between" align="start">
        <Statistic title={title} value={quick.count} />
        <Tooltip title={t('quickTile.openTooltip')}>
          <Link
            to={applicationsHref(quick.from, quick.to)}
            onClick={(event) => event.stopPropagation()}
            aria-label={t('quickTile.openAriaLabel', { label: title.toLowerCase() })}
          >
            <UnorderedListOutlined />
          </Link>
        </Tooltip>
      </Flex>
      <Delta count={quick.count} previous={quick.previous} against={against} />
    </Card>
  );
}

export function StatisticsPage() {
  const { t, i18n } = useTranslation('statistics');
  const [params, setParams] = useSearchParams();
  const today = todayDateOnly();
  const presets = useMemo(() => rangePresets(today, t), [today, t]);

  // No range in the URL means the last 30 days; `all` means everything on file.
  const all = params.get('all') === 'true';
  const from = all ? undefined : (params.get('from') ?? addDays(today, -29));
  const to = all ? undefined : (params.get('to') ?? today);
  const granularity = params.get('granularity') ?? 'auto';
  const includeArchived = params.get('archived') !== 'false';

  const query = useMemo(() => {
    const entries: Record<string, string> = {};
    if (from) entries.from = from;
    if (to) entries.to = to;
    if (granularity !== 'auto') entries.granularity = granularity;
    if (!includeArchived) entries.archived = 'false';
    return entries;
  }, [from, to, granularity, includeArchived]);

  const { data, isLoading, isFetching } = useStatistics(query);

  function patch(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  }

  const setRange = (range: { from: string; to: string }) =>
    patch({ from: range.from, to: range.to, all: null, granularity: null });

  if (isLoading || !data) return <Skeleton active paragraph={{ rows: 10 }} />;

  const { totals, range } = data;
  const tiles = TILE_WINDOWS.map((key) => data.quick.find((quick) => quick.key === key)!);
  const rangeLabel = presets.find((preset) => !all && preset.from === range.from && preset.to === range.to)?.label;
  const empty = totals.applications === 0 && totals.openingsSaved === 0;

  const breakdownRows = (rows: BreakdownRow[], href: (row: BreakdownRow) => string | null): RankedRow[] =>
    rows.map((row) => ({ ...row, href: row.value === null ? null : href(row) }));

  const columns: ColumnsType<Row> = [
    {
      title: t('columns.applied'),
      dataIndex: 'appliedOn',
      width: 112,
      sorter: (a, b) => a.appliedOn.localeCompare(b.appliedOn),
      defaultSortOrder: 'descend',
    },
    {
      title: t('columns.company'),
      key: 'company',
      width: 180,
      sorter: (a, b) => a.company.name.localeCompare(b.company.name),
      render: (_, row) => <Link to={`/companies/${row.company.id}`}>{row.company.name}</Link>,
    },
    {
      title: t('columns.jobTitle'),
      dataIndex: 'jobTitle',
      sorter: (a, b) => a.jobTitle.localeCompare(b.jobTitle),
      render: (value: string, row) => (
        <Space size={6}>
          <Link to={`/applications/${row.id}`}>{value}</Link>
          {row.jobUrl && (
            <Tooltip title={t('openPosting')}>
              <a href={row.jobUrl} target="_blank" rel="noreferrer" aria-label={t('openPostingAriaLabel', { title: value })}>
                <ExportOutlined />
              </a>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: t('columns.location'),
      key: 'location',
      width: 190,
      sorter: (a, b) => (a.location ?? '').localeCompare(b.location ?? ''),
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.location ?? <Typography.Text type="secondary">{t('notSet')}</Typography.Text>}</span>
          {row.workMode !== 'unspecified' && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {WORK_MODE_LABELS[row.workMode]}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t('columns.source'),
      dataIndex: 'sourceName',
      width: 130,
      sorter: (a, b) => (a.sourceName ?? '').localeCompare(b.sourceName ?? ''),
      render: (value: string | null) => value ?? <Typography.Text type="secondary">{t('notSet')}</Typography.Text>,
    },
    {
      title: t('columns.status'),
      dataIndex: 'status',
      width: 116,
      sorter: (a, b) => STATUS_LABELS[a.status].localeCompare(STATUS_LABELS[b.status]),
      render: (_, row) => <StatusTag status={row.status} />,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', opacity: isFetching ? 0.7 : 1, transition: 'opacity 120ms' }}>
      <Row gutter={[16, 16]}>
        {tiles.map((quick) => (
          <Col key={quick.key} flex="1 1 170px">
            <QuickTile
              quick={quick}
              active={!all && range.from === quick.from && range.to === quick.to}
              onPick={() => setRange(quick)}
            />
          </Col>
        ))}
      </Row>

      <Card size="small">
        <Flex justify="space-between" align="center" wrap gap={12}>
          <Space direction="vertical" size={0}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {all ? t('allTime') : (rangeLabel ?? t('customRange'))}
            </Typography.Title>
            <Typography.Text type="secondary">
              {t('rangeSubtitle', { from: range.from, to: range.to, count: range.days })}
            </Typography.Text>
          </Space>
          <Flex gap={12} wrap align="center">
            <DatePicker.RangePicker
              value={all ? null : [dayjs(range.from), dayjs(range.to)]}
              format="YYYY-MM-DD"
              allowClear={false}
              presets={presets.map((preset) => ({
                label: preset.label,
                value: [dayjs(preset.from), dayjs(preset.to)] as [Dayjs, Dayjs],
              }))}
              onChange={(dates) => {
                if (dates?.[0] && dates[1]) setRange({ from: dates[0].format('YYYY-MM-DD'), to: dates[1].format('YYYY-MM-DD') });
              }}
            />
            <Button type={all ? 'primary' : 'default'} onClick={() => patch({ all: 'true', from: null, to: null, granularity: null })}>
              {t('allTime')}
            </Button>
            <Segmented
              value={granularity}
              onChange={(value) => patch({ granularity: value === 'auto' ? null : String(value) })}
              options={[
                { label: t('granularity.auto'), value: 'auto' },
                { label: t('granularity.day'), value: 'day' },
                { label: t('granularity.week'), value: 'week' },
                { label: t('granularity.month'), value: 'month' },
              ]}
            />
            <Space size={6}>
              <Switch size="small" checked={includeArchived} onChange={(checked) => patch({ archived: checked ? null : 'false' })} />
              <Typography.Text>{t('includeArchived')}</Typography.Text>
            </Space>
          </Flex>
        </Flex>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title={t('tiles.applications')} value={totals.applications} />
            {all ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('tiles.since', { from: range.from })}
              </Typography.Text>
            ) : (
              <Delta
                count={totals.applications}
                previous={totals.previousApplications}
                against={t('tiles.daysBefore', { count: range.days })}
              />
            )}
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title={t('tiles.openingsSaved')} value={totals.openingsSaved} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('tiles.turnedIntoApplications', { count: totals.openingsConverted })}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title={t('tiles.responseRate')} value={Math.round(totals.responseRate * 100)} suffix="%" />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('tiles.heardBack', { responded: totals.responded, applications: totals.applications })}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title={t('tiles.activeDays')} value={totals.activeDays} suffix={`/ ${range.days}`} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('tiles.perActiveDay', { value: totals.perActiveDay.toFixed(1) })}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title={t('tiles.busiestDay')} value={totals.busiestDay?.count ?? 0} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {totals.busiestDay ? (
                <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 12 }} onClick={() => setRange({ from: totals.busiestDay!.date, to: totals.busiestDay!.date })}>
                  {totals.busiestDay.date}
                </Button>
              ) : (
                t('noApplicationsYet')
              )}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title={t('tiles.currentStreak')} value={totals.streak} suffix={t('tiles.streakUnit', { count: totals.streak })} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('tiles.streakDescription')}
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      {empty ? (
        <Card>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('emptyInRange')} />
        </Card>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={15}>
              <Card
                title={t('overTime.title')}
                size="small"
                extra={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('overTime.hint', { granularity: t(`granularity.${range.granularity}` as 'granularity.day') })}
                  </Typography.Text>
                }
              >
                <TimeBars points={data.series} onSelect={(bucket) => setRange({ from: bucket.start, to: bucket.end })} />
              </Card>
            </Col>
            <Col xs={24} xl={9}>
              <Card
                title={t('calendar.title')}
                size="small"
                extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('calendar.hint')}</Typography.Text>}
              >
                <CalendarHeatmap days={data.calendar} onSelect={(date) => setRange({ from: date, to: date })} />
              </Card>
            </Col>
          </Row>

          {totals.applications > 0 && (
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12} xl={8}>
                <Card title={t('byLocation.title')} size="small">
                  <RankedBars
                    title={t('byLocation.summary')}
                    rows={breakdownRows(data.byLocation, (row) => applicationsHref(range.from, range.to, { location: row.value! }))}
                  />
                </Card>
              </Col>
              <Col xs={24} md={12} xl={8}>
                <Card title={t('bySource.title')} size="small">
                  <RankedBars
                    title={t('bySource.summary')}
                    rows={breakdownRows(data.bySource, (row) => applicationsHref(range.from, range.to, { source: row.value! }))}
                  />
                </Card>
              </Col>
              <Col xs={24} md={12} xl={8}>
                <Card title={t('topCompanies.title')} size="small">
                  <RankedBars title={t('topCompanies.summary')} rows={breakdownRows(data.byCompany, (row) => `/companies/${row.value}`)} />
                </Card>
              </Col>
              <Col xs={24} md={12} xl={12}>
                <Card title={t('workMode.title')} size="small">
                  <RankedBars
                    title={t('workMode.summary')}
                    rows={breakdownRows(data.byWorkMode, (row) => applicationsHref(range.from, range.to, { workMode: row.value! }))}
                  />
                </Card>
              </Col>
              <Col xs={24} md={24} xl={12}>
                <Card title={t('currentStatus.title')} size="small">
                  <RankedBars
                    title={t('currentStatus.summary')}
                    rows={data.byStatus.map((row) => ({
                      ...row,
                      labelNode: (
                        <Link to={applicationsHref(range.from, range.to, { status: row.key })}>
                          <StatusTag status={row.key as Row['status']} />
                        </Link>
                      ),
                    }))}
                  />
                </Card>
              </Col>
            </Row>
          )}

          <Card
            title={t('tableTitle', { count: data.applications.length })}
            size="small"
            extra={
              <Link to={applicationsHref(range.from, range.to)}>
                <Button size="small" icon={<UnorderedListOutlined />}>
                  {t('openInApplications')}
                </Button>
              </Link>
            }
          >
            <Table<Row>
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={data.applications}
              pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
              scroll={{ x: 820 }}
              locale={{ emptyText: t('tableEmpty') }}
            />
          </Card>
        </>
      )}
    </Space>
  );
}
