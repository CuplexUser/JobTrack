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
import type { ColumnsType } from 'antd/es/table';
import {
  DownloadOutlined,
  FilterOutlined,
  PlusOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  monthName,
  type JobApplicationView,
} from '@jobtrack/shared';
import { useApplications, usePeriods, useTags } from '../api/hooks.js';
import { api } from '../api/client.js';
import { PeriodTree } from '../components/PeriodTree.js';
import { StatusTag } from '../components/StatusTag.js';
import { ApplicationDrawer } from '../components/ApplicationDrawer.js';

export function ApplicationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The URL is the single source of truth for the filter state.
  const filter = useMemo(() => {
    const entries: Record<string, unknown> = {};
    for (const key of ['q', 'source', 'sort', 'direction', 'cursor'] as const) {
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
  }, [params]);

  const { data, isLoading, isFetching } = useApplications(filter);
  const { data: periodData } = usePeriods();
  const { data: tagData } = useTags();

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
    // Any filter change invalidates the page cursor.
    next.delete('cursor');
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
                {data ? `${data.total} application${data.total === 1 ? '' : 's'}` : 'Loading…'}
              </Typography.Text>
            </Space>

            <Space>
              <Dropdown
                menu={{
                  items: [
                    { key: 'csv', label: 'Export as CSV' },
                    { key: 'xlsx', label: 'Export as Excel (.xlsx)' },
                  ],
                  onClick: ({ key }) => {
                    // A plain navigation, so the browser handles the download itself.
                    window.location.href = api.exportUrl(filter, key as 'csv' | 'xlsx');
                  },
                }}
              >
                <Button icon={<DownloadOutlined />}>Export</Button>
              </Dropdown>
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
                  value={params.get('sort') ?? 'appliedOn'}
                  onChange={(value) => patchFilter({ sort: value })}
                  options={[
                    { value: 'appliedOn', label: 'Sort: date applied' },
                    { value: 'company', label: 'Sort: company' },
                    { value: 'jobTitle', label: 'Sort: job title' },
                    { value: 'status', label: 'Sort: status' },
                  ]}
                />
                <Select
                  style={{ width: 130 }}
                  value={params.get('direction') ?? 'desc'}
                  onChange={(value) => patchFilter({ direction: value })}
                  options={[
                    { value: 'desc', label: 'Newest first' },
                    { value: 'asc', label: 'Oldest first' },
                  ]}
                />
              </Flex>

              {data?.searched && !data.semanticReady && (
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
            dataSource={data?.items ?? []}
            loading={isLoading || isFetching}
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
              data?.hasMore
                ? () => (
                    <Flex justify="center">
                      <Tooltip title="Loads the next page">
                        <Button onClick={() => patchFilterCursor(params, setParams, data.cursor)}>
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
    </Row>
  );
}

/** Paging keeps the cursor in the URL so the back button steps back through pages. */
function patchFilterCursor(
  params: URLSearchParams,
  setParams: (next: URLSearchParams) => void,
  cursor: string | null,
): void {
  if (!cursor) return;
  const next = new URLSearchParams(params);
  next.set('cursor', cursor);
  setParams(next);
}
