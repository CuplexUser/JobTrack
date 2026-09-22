/**
 * The main view: year/month tree on the left, filtered table on the right.
 *
 * All filter state lives in the URL query string, so a particular view — "March 2026,
 * interviews only" — is a link you can bookmark or send yourself, and the browser back
 * button behaves the way people expect.
 */

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Dropdown,
  Empty,
  Flex,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined,
  DownloadOutlined,
  FilterOutlined,
  PlusOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  type JobApplicationView,
} from '@jobtrack/shared';
import { useApplicationLocations, useApplicationsInfinite, usePeriods, useTags } from '../api/hooks.js';
import { api } from '../api/index.js';
import { demoExportCsv } from '../api/demo-client.js';
import { PeriodTree } from '../components/PeriodTree.js';
import { StatusTag } from '../components/StatusTag.js';
import { ApplicationDrawer } from '../components/ApplicationDrawer.js';
import { ImportModal } from '../components/ImportModal.js';

/**
 * XLSX export needs `exceljs`, which does not belong in a browser bundle, and the CSV path
 * needs to build the file client-side instead of navigating to a server route — see
 * `demoExportCsv` in `demo-client.ts`.
 */
const DEMO = import.meta.env.VITE_DEMO === 'true';

/**
 * The sort fields, and how each one's direction reads. A date sorts newest-first by
 * default and says so; text sorts read A–Z, which is also what people expect to get
 * first when they pick one.
 */
/** `label` is a translation key, resolved with `t()` wherever these render. */
const SORT_OPTIONS = [
  { value: 'appliedOn', label: 'list.sort.appliedOn', kind: 'date' },
  { value: 'company', label: 'list.sort.company', kind: 'text' },
  { value: 'jobTitle', label: 'list.sort.jobTitle', kind: 'text' },
  { value: 'status', label: 'list.sort.status', kind: 'text' },
] as const;

const DIRECTION_OPTIONS: Record<'date' | 'text', { value: string; label: string }[]> = {
  date: [
    { value: 'desc', label: 'list.direction.newestFirst' },
    { value: 'asc', label: 'list.direction.oldestFirst' },
  ],
  text: [
    { value: 'asc', label: 'list.direction.azAsc' },
    { value: 'desc', label: 'list.direction.azDesc' },
  ],
};

function directionKind(sort: string): 'date' | 'text' {
  return SORT_OPTIONS.find((option) => option.value === sort)?.kind ?? 'date';
}

/** The first option for the field's kind — newest for dates, A–Z for text. */
function defaultDirection(sort: string): string {
  return DIRECTION_OPTIONS[directionKind(sort)][0]!.value;
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ApplicationsPage() {
  const { t, i18n } = useTranslation('applications');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const sort = params.get('sort') ?? 'appliedOn';
  // A URL without an explicit direction sorts the way the picker says it does, rather than
  // falling back to the API's date-shaped default.
  const direction = params.get('direction') ?? defaultDirection(sort);

  // The URL is the single source of truth for the filter state.
  const filter = useMemo(() => {
    const entries: Record<string, unknown> = { sort, direction };
    // `location` stays a `|`-joined string all the way to the API: locations contain
    // commas, so the comma-joining every other list filter uses would split them apart.
    for (const key of ['q', 'source', 'from', 'to', 'location'] as const) {
      const value = params.get(key);
      if (value) entries[key] = value;
    }
    for (const key of ['year', 'month'] as const) {
      const value = params.get(key);
      if (value) entries[key] = Number(value);
    }
    for (const key of ['status', 'workMode', 'tags'] as const) {
      const value = params.get(key);
      if (value) entries[key] = value.split(',');
    }
    return entries;
  }, [params, sort, direction]);

  const { data, isLoading, isFetching, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useApplicationsInfinite(filter);
  const { data: periodData } = usePeriods();
  const { data: tagData } = useTags();
  const { data: locationData } = useApplicationLocations();
  const selectedLocations = params.get('location')?.split('|').filter(Boolean) ?? [];

  // "Load more" appends, so the table shows every page fetched so far. Totals and the
  // search flags describe the whole result set, so they come from the first page.
  const pages = data?.pages ?? [];
  // Keyed on `data`, not on `pages`: the `?? []` fallback is a new array every render, so
  // depending on it would rebuild the list on renders that fetched nothing.
  const items = useMemo(() => (data?.pages ?? []).flatMap((page) => page.items), [data]);
  const summary = pages[0];

  function patchFilter(changes: Record<string, unknown>): void {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === null || value === '' ||
          (Array.isArray(value) && value.length === 0)) {
        next.delete(key);
      } else {
        const separator = key === 'location' ? '|' : ',';
        next.set(key, Array.isArray(value) ? value.join(separator) : String(value));
      }
    }
    setParams(next, { replace: true });
  }

  const columns: ColumnsType<JobApplicationView> = [
    {
      title: t('list.columns.applied'),
      dataIndex: 'appliedOn',
      width: 118,
      sorter: false,
      render: (value: string) => <Typography.Text>{value}</Typography.Text>,
    },
    {
      title: t('list.columns.company'),
      key: 'company',
      width: 190,
      render: (_, row) => (
        <Button
          type="link"
          style={{ padding: 0, height: 'auto' }}
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/companies/${row.company.id}`);
          }}
        >
          {row.company.name}
        </Button>
      ),
    },
    {
      title: t('list.columns.jobTitle'),
      dataIndex: 'jobTitle',
      render: (value: string, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          {row.location && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.location} · {WORK_MODE_LABELS[row.workMode]}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t('list.columns.status'),
      dataIndex: 'status',
      width: 116,
      render: (_, row) => <StatusTag status={row.status} />,
    },
    {
      title: t('list.columns.tags'),
      key: 'tags',
      width: 210,
      render: (_, row) => (
        <Space size={4} wrap>
          {row.tags.map((tag) => (
            <Tag key={tag.id} color={tag.color ?? undefined} style={{ marginInlineEnd: 0 }}>
              {tag.name}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('list.columns.source'),
      dataIndex: 'sourceName',
      width: 120,
      render: (value: string | null) => value ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
  ];

  const fromParam = params.get('from');
  const toParam = params.get('to');
  const dateRangeValue: [Dayjs, Dayjs] | null =
    fromParam && toParam ? [dayjs(fromParam), dayjs(toParam)] : null;

  const today = dayjs();
  const dateRangePresets: { label: string; value: [Dayjs, Dayjs] }[] = [
    { label: t('list.presets.today'), value: [today, today] },
    { label: t('list.presets.yesterday'), value: [today.subtract(1, 'day'), today.subtract(1, 'day')] },
    { label: t('list.presets.thisWeek'), value: [today.startOf('week'), today.endOf('week')] },
    { label: t('list.presets.thisMonth'), value: [today.startOf('month'), today.endOf('month')] },
    { label: t('list.presets.last7Days'), value: [today.subtract(6, 'day'), today] },
    { label: t('list.presets.last30Days'), value: [today.subtract(29, 'day'), today] },
  ];

  function handleDateRangeChange(dates: [Dayjs | null, Dayjs | null] | null): void {
    if (!dates || !dates[0] || !dates[1]) {
      patchFilter({ from: '', to: '' });
      return;
    }
    patchFilter({ from: dates[0].format('YYYY-MM-DD'), to: dates[1].format('YYYY-MM-DD') });
  }

  const year = params.get('year') ? Number(params.get('year')) : undefined;
  const month = params.get('month') ? Number(params.get('month')) : undefined;

  const scopeLabel =
    year && month
      ? `${new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(Date.UTC(year, month - 1, 1)))} ${year}`
      : year
        ? String(year)
        : t('list.allApplications');

  return (
    <Row gutter={16}>
      <Col xs={24} md={6} lg={5}>
        <Card
          size="small"
          title={t('list.byPeriod')}
          extra={
            (year || month) && (
              <Button size="small" type="link" onClick={() => patchFilter({ year: '', month: '' })}>
                {t('list.clear')}
              </Button>
            )
          }
          styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        >
          <PeriodTree
            periods={periodData?.periods ?? []}
            year={year}
            month={month}
            onSelect={(selection) =>
              patchFilter({ year: selection.year ?? '', month: selection.month ?? '' })
            }
          />
        </Card>
      </Col>

      <Col xs={24} md={18} lg={19}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Flex justify="space-between" align="center" wrap gap={12}>
            <Space direction="vertical" size={0}>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {scopeLabel}
              </Typography.Title>
              <Typography.Text type="secondary">
                {summary
                  ? items.length < summary.total
                    ? t('list.showingOfTotal', { shown: items.length, total: summary.total })
                    : t('list.totalCount', { count: summary.total })
                  : t('list.loading')}
              </Typography.Text>
            </Space>

            <Space>
              <Dropdown
                menu={{
                  items: DEMO
                    ? [{ key: 'csv', label: t('list.exportCsv') }]
                    : [
                        { key: 'csv', label: t('list.exportCsv') },
                        { key: 'xlsx', label: t('list.exportXlsx') },
                      ],
                  onClick: ({ key }) => {
                    if (DEMO) {
                      void demoExportCsv(filter).then(({ filename, blob }) => downloadBlob(filename, blob));
                      return;
                    }
                    // A plain navigation, so the browser handles the download itself.
                    window.location.href = api.exportUrl(filter, key as 'csv' | 'xlsx');
                  },
                }}
              >
                <Button icon={<DownloadOutlined />}>{t('list.export')}</Button>
              </Dropdown>
              <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
                {t('list.import')}
              </Button>
              <Button icon={<CopyOutlined />} onClick={() => navigate('/applications/duplicates')}>
                {t('list.duplicatesButton')}
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
                {t('list.newApplication')}
              </Button>
            </Space>
          </Flex>

          <Card size="small">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Input
                allowClear
                size="large"
                prefix={<SearchOutlined />}
                placeholder={t('list.searchPlaceholder')}
                defaultValue={params.get('q') ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '') patchFilter({ q: '' });
                }}
                onPressEnter={(event) =>
                  patchFilter({ q: (event.target as HTMLInputElement).value })
                }
              />

              <Flex gap={8} wrap>
                <DatePicker.RangePicker
                  allowClear
                  value={dateRangeValue}
                  presets={dateRangePresets}
                  format="YYYY-MM-DD"
                  onChange={(dates) => handleDateRangeChange(dates as [Dayjs | null, Dayjs | null] | null)}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder={t('list.filters.status')}
                  style={{ minWidth: 180 }}
                  suffixIcon={<FilterOutlined />}
                  value={params.get('status')?.split(',') ?? []}
                  onChange={(value) => patchFilter({ status: value })}
                  options={APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder={t('list.filters.workMode')}
                  style={{ minWidth: 160 }}
                  value={params.get('workMode')?.split(',') ?? []}
                  onChange={(value) => patchFilter({ workMode: value })}
                  options={WORK_MODES.map((m) => ({ value: m, label: WORK_MODE_LABELS[m] }))}
                />
                <Select
                  // `tags` mode: pick a location on file, or type any fragment ("Sweden").
                  mode="tags"
                  allowClear
                  placeholder={t('list.filters.location')}
                  style={{ minWidth: 200 }}
                  value={selectedLocations}
                  onChange={(value: string[]) =>
                    patchFilter({ location: value.map((v) => v.replace(/\|/g, ' ').trim()).filter(Boolean) })
                  }
                  optionFilterProp="value"
                  options={(locationData?.locations ?? []).map((l) => ({
                    value: l.label,
                    label: `${l.label} (${l.count})`,
                  }))}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder={t('list.filters.tags')}
                  style={{ minWidth: 200 }}
                  value={params.get('tags')?.split(',') ?? []}
                  onChange={(value) => patchFilter({ tags: value })}
                  options={(tagData?.tags ?? []).map((tag) => ({ value: tag.name, label: tag.name }))}
                />
                <Select
                  style={{ minWidth: 170 }}
                  value={sort}
                  // Switching fields also resets the direction: carrying "Z–A" over from
                  // the previous field is never what someone means by picking a new sort.
                  onChange={(value) =>
                    patchFilter({ sort: value, direction: defaultDirection(value) })
                  }
                  options={SORT_OPTIONS.map(({ value, label }) => ({ value, label: t(label) }))}
                />
                <Select
                  style={{ width: 130 }}
                  value={direction}
                  onChange={(value) => patchFilter({ direction: value })}
                  options={DIRECTION_OPTIONS[directionKind(sort)].map(({ value, label }) => ({ value, label: t(label) }))}
                />
              </Flex>

              {summary?.searched && !summary.semanticReady && (
                <Alert
                  type="info"
                  showIcon
                  icon={<ThunderboltOutlined />}
                  message={t('list.semanticLoading')}
                />
              )}
            </Space>
          </Card>

          <Table<JobApplicationView>
            rowKey="id"
            columns={columns}
            dataSource={items}
            // The next page has its own button spinner; overlaying the table would hide
            // the rows that are already loaded.
            loading={isLoading || (isFetching && !isFetchingNextPage)}
            pagination={false}
            onRow={(row) => ({
              onClick: () => navigate(`/applications/${row.id}`),
              style: { cursor: 'pointer' },
            })}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    params.get('q')
                      ? t('list.noMatch', { query: params.get('q') })
                      : t('list.noResults')
                  }
                />
              ),
            }}
            footer={
              hasNextPage
                ? () => (
                    <Flex justify="center">
                      <Tooltip title={t('list.loadMoreTooltip')}>
                        <Button loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                          {t('list.loadMore')}
                        </Button>
                      </Tooltip>
                    </Flex>
                  )
                : undefined
            }
          />
        </Space>
      </Col>

      <ApplicationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </Row>
  );
}
