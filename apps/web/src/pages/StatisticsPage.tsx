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

/** Range presets, as calendar days. Weeks start on Monday, the same as the counts. */
function rangePresets(today: string): { label: string; from: string; to: string }[] {
  const monday = startOfIsoWeek(today);
  const monthStart = startOfMonth(today);
  const lastMonth = addDays(monthStart, -1);
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'This week', from: monday, to: addDays(monday, 6) },
    { label: 'Last week', from: addDays(monday, -7), to: addDays(monday, -1) },
    { label: 'This month', from: monthStart, to: endOfMonth(today) },
    { label: 'Last month', from: startOfMonth(lastMonth), to: lastMonth },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
    { label: 'Last 90 days', from: addDays(today, -89), to: today },
    { label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
  ];
}

/** A link into the applications list for a date range plus one more filter. */
function applicationsHref(from: string, to: string, extra: Record<string, string> = {}): string {
  return `/applications?${new URLSearchParams({ ...extra, from, to }).toString()}`;
}

function Delta({ count, previous, against }: { count: number; previous: number; against: string }) {
  const change = count - previous;
  if (change === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        same as {against}
      </Typography.Text>
    );
  }
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {change > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(change)} {change > 0 ? 'more' : 'fewer'} than {against}
    </Typography.Text>
  );
}

function QuickTile({ quick, onPick, active }: { quick: QuickWindow; onPick: () => void; active: boolean }) {
  return (
    <Card
      size="small"
      hoverable
      onClick={onPick}
      style={active ? { borderColor: 'var(--jt-accent)' } : undefined}
      aria-label={`Show ${quick.label.toLowerCase()}: ${quick.count} applications`}
    >
      <Flex justify="space-between" align="start">
        <Statistic title={quick.label} value={quick.count} />
        <Tooltip title="Open these in Applications">
          <Link to={applicationsHref(quick.from, quick.to)} onClick={(event) => event.stopPropagation()} aria-label={`Open ${quick.label.toLowerCase()} in Applications`}>
            <UnorderedListOutlined />
          </Link>
        </Tooltip>
      </Flex>
      <Delta count={quick.count} previous={quick.previous} against={quick.previousLabel} />
    </Card>
  );
}

export function StatisticsPage() {
  const [params, setParams] = useSearchParams();
  const today = todayDateOnly();
  const presets = useMemo(() => rangePresets(today), [today]);

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
      title: 'Applied',
      dataIndex: 'appliedOn',
      width: 112,
      sorter: (a, b) => a.appliedOn.localeCompare(b.appliedOn),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Company',
      key: 'company',
      width: 180,
      sorter: (a, b) => a.company.name.localeCompare(b.company.name),
      render: (_, row) => <Link to={`/companies/${row.company.id}`}>{row.company.name}</Link>,
    },
    {
      title: 'Job title',
      dataIndex: 'jobTitle',
      sorter: (a, b) => a.jobTitle.localeCompare(b.jobTitle),
      render: (value: string, row) => (
        <Space size={6}>
          <Link to={`/applications/${row.id}`}>{value}</Link>
          {row.jobUrl && (
            <Tooltip title="Open the posting">
              <a href={row.jobUrl} target="_blank" rel="noreferrer" aria-label={`Open the posting for ${value}`}>
                <ExportOutlined />
              </a>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Location',
      key: 'location',
      width: 190,
      sorter: (a, b) => (a.location ?? '').localeCompare(b.location ?? ''),
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.location ?? <Typography.Text type="secondary">Not set</Typography.Text>}</span>
          {row.workMode !== 'unspecified' && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {WORK_MODE_LABELS[row.workMode]}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Source',
      dataIndex: 'sourceName',
      width: 130,
      sorter: (a, b) => (a.sourceName ?? '').localeCompare(b.sourceName ?? ''),
      render: (value: string | null) => value ?? <Typography.Text type="secondary">Not set</Typography.Text>,
    },
    {
      title: 'Status',
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
              {all ? 'All time' : (rangeLabel ?? 'Custom range')}
            </Typography.Title>
            <Typography.Text type="secondary">
              {range.from} to {range.to} · {range.days} day{range.days === 1 ? '' : 's'}
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
              All time
            </Button>
            <Segmented
              value={granularity}
              onChange={(value) => patch({ granularity: value === 'auto' ? null : String(value) })}
              options={[
                { label: 'Auto', value: 'auto' },
                { label: 'Day', value: 'day' },
                { label: 'Week', value: 'week' },
                { label: 'Month', value: 'month' },
              ]}
            />
            <Space size={6}>
              <Switch size="small" checked={includeArchived} onChange={(checked) => patch({ archived: checked ? null : 'false' })} />
              <Typography.Text>Include archived</Typography.Text>
            </Space>
          </Flex>
        </Flex>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title="Applications" value={totals.applications} />
            {all ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                since {range.from}
              </Typography.Text>
            ) : (
              <Delta
                count={totals.applications}
                previous={totals.previousApplications}
                against={`the ${range.days} day${range.days === 1 ? '' : 's'} before`}
              />
            )}
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title="Openings saved" value={totals.openingsSaved} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {totals.openingsConverted} turned into applications
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title="Response rate" value={Math.round(totals.responseRate * 100)} suffix="%" />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {totals.responded} of {totals.applications} heard back
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title="Active days" value={totals.activeDays} suffix={`/ ${range.days}`} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {totals.perActiveDay.toFixed(1)} per active day
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title="Busiest day" value={totals.busiestDay?.count ?? 0} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {totals.busiestDay ? (
                <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 12 }} onClick={() => setRange({ from: totals.busiestDay!.date, to: totals.busiestDay!.date })}>
                  {totals.busiestDay.date}
                </Button>
              ) : (
                'No applications yet'
              )}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card size="small">
            <Statistic title="Current streak" value={totals.streak} suffix={totals.streak === 1 ? 'day' : 'days'} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              days in a row with an application
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      {empty ? (
        <Card>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No applications or openings in this range" />
        </Card>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={15}>
              <Card
                title="Over time"
                size="small"
                extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>per {range.granularity}, click a column to zoom in</Typography.Text>}
              >
                <TimeBars points={data.series} onSelect={(bucket) => setRange({ from: bucket.start, to: bucket.end })} />
              </Card>
            </Col>
            <Col xs={24} xl={9}>
              <Card
                title="Activity calendar"
                size="small"
                extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>click a day to see it</Typography.Text>}
              >
                <CalendarHeatmap days={data.calendar} onSelect={(date) => setRange({ from: date, to: date })} />
              </Card>
            </Col>
          </Row>

          {totals.applications > 0 && (
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12} xl={8}>
                <Card title="By location" size="small">
                  <RankedBars
                    title="Applications by location"
                    rows={breakdownRows(data.byLocation, (row) => applicationsHref(range.from, range.to, { location: row.value! }))}
                  />
                </Card>
              </Col>
              <Col xs={24} md={12} xl={8}>
                <Card title="By source" size="small">
                  <RankedBars
                    title="Applications by source"
                    rows={breakdownRows(data.bySource, (row) => applicationsHref(range.from, range.to, { source: row.value! }))}
                  />
                </Card>
              </Col>
              <Col xs={24} md={12} xl={8}>
                <Card title="Top companies" size="small">
                  <RankedBars title="Applications by company" rows={breakdownRows(data.byCompany, (row) => `/companies/${row.value}`)} />
                </Card>
              </Col>
              <Col xs={24} md={12} xl={12}>
                <Card title="Work mode" size="small">
                  <RankedBars
                    title="Applications by work mode"
                    rows={breakdownRows(data.byWorkMode, (row) => applicationsHref(range.from, range.to, { workMode: row.value! }))}
                  />
                </Card>
              </Col>
              <Col xs={24} md={24} xl={12}>
                <Card title="Where they stand now" size="small">
                  <RankedBars
                    title="Applications by current status"
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
            title={`Applications in this range (${data.applications.length})`}
            size="small"
            extra={
              <Link to={applicationsHref(range.from, range.to)}>
                <Button size="small" icon={<UnorderedListOutlined />}>
                  Open in Applications
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
              locale={{ emptyText: 'No applications in this range' }}
            />
          </Card>
        </>
      )}
    </Space>
  );
}
