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
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  monthName,
  type JobApplicationView,
} from '@jobtrack/shared';
import { useApplicationsInfinite, usePeriods, useTags } from '../api/hooks.js';
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
const SORT_OPTIONS = [
  { value: 'appliedOn', label: 'Sort: date applied', kind: 'date' },
  { value: 'company', label: 'Sort: company', kind: 'text' },
  { value: 'jobTitle', label: 'Sort: job title', kind: 'text' },
  { value: 'status', label: 'Sort: status', kind: 'text' },
] as const;

const DIRECTION_OPTIONS: Record<'date' | 'text', { value: string; label: string }[]> = {
  date: [
    { value: 'desc', label: 'Newest first' },
    { value: 'asc', label: 'Oldest first' },
  ],
  text: [
    { value: 'asc', label: 'A–Z' },
    { value: 'desc', label: 'Z–A' },
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
    for (const key of ['q', 'source', 'from', 'to'] as const) {
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

  // "Load more" appends, so the table shows every page fetched so far. Totals and the
  // search flags describe the whole result set, so they come from the first page.
  const pages = data?.pages ?? [];
  const items = useMemo(() => pages.flatMap((page) => page.items), [pages]);
  const summary = pages[0];

  function patchFilter(changes: Record<string, unknown>): void {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === null || value === '' ||
          (Array.isArray(value) && value.length === 0)) {
        next.delete(key);
      } else {
        next.set(key, Array.isArray(value) ? value.join(',') : String(value));
      }
    }
    setParams(next, { replace: true });
  }

  const columns: ColumnsType<JobApplicationView> = [
    {
      title: 'Applied',
      dataIndex: 'appliedOn',
      width: 118,
      sorter: false,
      render: (value: string) => <Typography.Text>{value}</Typography.Text>,
    },
    {
      title: 'Company',
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
      title: 'Job title',
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
      title: 'Status',
      dataIndex: 'status',
      width: 116,
      render: (_, row) => <StatusTag status={row.status} />,
    },
    {
      title: 'Tags',
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
      title: 'Source',
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
    { label: 'Today', value: [today, today] },
    { label: 'Yesterday', value: [today.subtract(1, 'day'), today.subtract(1, 'day')] },
    { label: 'This week', value: [today.startOf('week'), today.endOf('week')] },
    { label: 'This month', value: [today.startOf('month'), today.endOf('month')] },
    { label: 'Last 7 days', value: [today.subtract(6, 'day'), today] },
    { label: 'Last 30 days', value: [today.subtract(29, 'day'), today] },
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
    year && month ? `${monthName(month)} ${year}` : year ? String(year) : 'All applications';

  return (
    <Row gutter={16}>
      <Col xs={24} md={6} lg={5}>
        <Card
          size="small"
          title="By period"
          extra={
            (year || month) && (
              <Button size="small" type="link" onClick={() => patchFilter({ year: '', month: '' })}>
                Clear
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
                    ? `Showing ${items.length} of ${summary.total} applications`
                    : `${summary.total} application${summary.total === 1 ? '' : 's'}`
                  : 'Loading…'}
              </Typography.Text>
            </Space>

            <Space>
              <Dropdown
                menu={{
                  items: DEMO
                    ? [{ key: 'csv', label: 'Export as CSV' }]
                    : [
                        { key: 'csv', label: 'Export as CSV' },
                        { key: 'xlsx', label: 'Export as Excel (.xlsx)' },
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
                <Button icon={<DownloadOutlined />}>Export</Button>
              </Dropdown>
              <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
                Import
              </Button>
              <Button icon={<CopyOutlined />} onClick={() => navigate('/applications/duplicates')}>
                Duplicates
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
                New application
              </Button>
            </Space>
          </Flex>

          <Card size="small">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Input
                allowClear
                size="large"
                prefix={<SearchOutlined />}
                placeholder="Search by meaning — try “server-side developer” or “remote fintech”"
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
                  placeholder="Status"
                  style={{ minWidth: 180 }}
                  suffixIcon={<FilterOutlined />}
                  value={params.get('status')?.split(',') ?? []}
                  onChange={(value) => patchFilter({ status: value })}
                  options={APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Work mode"
                  style={{ minWidth: 160 }}
                  value={params.get('workMode')?.split(',') ?? []}
                  onChange={(value) => patchFilter({ workMode: value })}
                  options={WORK_MODES.map((m) => ({ value: m, label: WORK_MODE_LABELS[m] }))}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Tags"
                  style={{ minWidth: 200 }}
                  value={params.get('tags')?.split(',') ?? []}
                  onChange={(value) => patchFilter({ tags: value })}
                  options={(tagData?.tags ?? []).map((t) => ({ value: t.name, label: t.name }))}
                />
                <Select
                  style={{ minWidth: 170 }}
                  value={sort}
                  // Switching fields also resets the direction: carrying "Z–A" over from
                  // the previous field is never what someone means by picking a new sort.
                  onChange={(value) =>
                    patchFilter({ sort: value, direction: defaultDirection(value) })
                  }
                  options={SORT_OPTIONS.map(({ value, label }) => ({ value, label }))}
                />
                <Select
                  style={{ width: 130 }}
                  value={direction}
                  onChange={(value) => patchFilter({ direction: value })}
                  options={DIRECTION_OPTIONS[directionKind(sort)]}
                />
              </Flex>

              {summary?.searched && !summary.semanticReady && (
                <Alert
                  type="info"
                  showIcon
                  icon={<ThunderboltOutlined />}
                  message="Results will improve shortly — the semantic model is still loading."
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
                      ? `Nothing matched “${params.get('q')}”`
                      : 'No applications for this filter'
                  }
                />
              ),
            }}
            footer={
              hasNextPage
                ? () => (
                    <Flex justify="center">
                      <Tooltip title="Adds the next page to the list">
                        <Button loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                          Load more
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
