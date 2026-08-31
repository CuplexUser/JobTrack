/**
 * Companies, with the counts that make repeat applications obvious at a glance.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Flex, Input, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import type { CompanyWithStats } from '@jobtrack/shared';
import { useCompanies } from '../api/hooks.js';
import { useDebounced } from '../hooks/useDebounced.js';

const DEFAULT_PAGE_SIZE = 25;

export function CompaniesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const debounced = useDebounced(search, 300);
  const { data, isLoading } = useCompanies(debounced ? { q: debounced } : {});

  const columns: ColumnsType<CompanyWithStats> = [
    {
      title: 'Company',
      dataIndex: 'name',
      render: (value: string, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          {row.website && (
            <Typography.Link href={row.website} target="_blank" style={{ fontSize: 12 }}>
              {row.website.replace(/^https?:\/\//, '')}
            </Typography.Link>
          )}
        </Space>
      ),
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: 'Applications',
      dataIndex: 'applicationCount',
      width: 140,
      align: 'right',
      sorter: (a, b) => a.applicationCount - b.applicationCount,
      defaultSortOrder: 'descend',
      render: (count: number) => (
        // More than a couple of applications at one employer is worth noticing.
        <Typography.Text strong={count > 2} type={count > 2 ? 'warning' : undefined}>
          {count}
        </Typography.Text>
      ),
    },
    {
      title: 'Active',
      dataIndex: 'activeCount',
      width: 90,
      align: 'right',
    },
    {
      title: 'Last applied',
      dataIndex: 'lastAppliedOn',
      width: 130,
      sorter: (a, b) => (a.lastAppliedOn ?? '').localeCompare(b.lastAppliedOn ?? ''),
      render: (value: string | null) => value ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Tags',
      key: 'tags',
      width: 260,
      render: (_, row) => (
        <Space size={4} wrap>
          {row.tags.map((tag) => (
            <Tag key={tag.id} style={{ marginInlineEnd: 0 }}>
              {tag.name}
            </Tag>
          ))}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={12}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Companies
        </Typography.Title>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Find a company"
          style={{ maxWidth: 320 }}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Flex>

      <Card size="small">
        <Table<CompanyWithStats>
          rowKey="id"
          size="middle"
          loading={isLoading}
          columns={columns}
          dataSource={data?.companies ?? []}
          pagination={{
            pageSize,
            showSizeChanger: true,
            // The page size is ours to hold: passing it without taking the change back
            // pins the table to one size whatever the size changer says.
            onChange: (_page, size) => setPageSize(size),
            // Tidy away the bar for a short list, but only while nobody has picked a
            // size — hiding it after a choice would leave no way to pick another.
            hideOnSinglePage: pageSize === DEFAULT_PAGE_SIZE,
          }}
          onRow={(row) => ({
            onClick: () => navigate(`/companies/${row.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>
    </Space>
  );
}
