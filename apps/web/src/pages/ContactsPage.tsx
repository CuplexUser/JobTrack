/**
 * The network: everyone the user knows, with who is due a follow-up surfaced first.
 *
 * Filters live in the URL, like the applications page, so "recruiters due a reconnect" is a
 * link that can be bookmarked.
 */

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Flex, Input, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LinkedinOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { RELATIONSHIPS, RELATIONSHIP_LABELS, todayDateOnly, type ContactView } from '@jobtrack/shared';
import { useContacts } from '../api/hooks.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { ContactDrawer } from '../components/ContactDrawer.js';
import { LinkedInImportModal } from '../components/LinkedInImportModal.js';
import { parse, usePreference } from '../preferences.js';

const DEFAULT_PAGE_SIZE = 25;

/**
 * A network export can run to thousands of people, and the table pages and sorts them in the
 * browser, so ask for all of them rather than the API's shorter default.
 */
const CONTACT_LIMIT = 5000;

export function ContactsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [pageSize, setPageSize] = usePreference('view', 'people.pageSize', DEFAULT_PAGE_SIZE, parse.pageSize);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const debounced = useDebounced(search, 300);

  const relationship = params.get('relationship')?.split(',').filter(Boolean) ?? [];
  const view = params.get('view') === 'reconnect' ? 'reconnect' : 'all';

  const { data, isLoading } = useContacts({
    limit: CONTACT_LIMIT,
    ...(debounced ? { q: debounced } : {}),
    ...(relationship.length > 0 ? { relationship } : {}),
    ...(view === 'reconnect' ? { reconnectDue: true } : {}),
  });

  function patchParams(changes: Record<string, string | string[] | null>): void {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      const text = Array.isArray(value) ? value.join(',') : value;
      if (text) next.set(key, text);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  const today = todayDateOnly();

  const columns: ColumnsType<ContactView> = [
    {
      title: 'Name',
      dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (value: string, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          {row.headline && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.headline}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Works at',
      dataIndex: 'companyName',
      width: 220,
      sorter: (a, b) => (a.companyName ?? '').localeCompare(b.companyName ?? ''),
    },
    {
      title: 'How you know them',
      dataIndex: 'relationship',
      width: 170,
      render: (_, row) => <Tag>{RELATIONSHIP_LABELS[row.relationship]}</Tag>,
    },
    {
      title: 'Last spoke',
      dataIndex: 'lastInteractionOn',
      width: 130,
      sorter: (a, b) => (a.lastInteractionOn ?? '').localeCompare(b.lastInteractionOn ?? ''),
      render: (value: string | null) => value ?? <Typography.Text type="secondary">Never</Typography.Text>,
    },
    {
      title: 'Reconnect on',
      dataIndex: 'reconnectOn',
      width: 140,
      sorter: (a, b) => (a.reconnectOn ?? '9999').localeCompare(b.reconnectOn ?? '9999'),
      render: (value: string | null) =>
        value ? <Typography.Text type={value <= today ? 'danger' : undefined}>{value}</Typography.Text> : null,
    },
  ];

  const total = data?.contacts.length ?? 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={12}>
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            People
          </Typography.Title>
          <Typography.Text type="secondary">
            {view === 'reconnect'
              ? `${total} ${total === 1 ? 'person' : 'people'} due a reconnect`
              : `${total} ${total === 1 ? 'person' : 'people'} in your network`}
          </Typography.Text>
        </Space>
        <Space wrap>
          <Button icon={<LinkedinOutlined />} onClick={() => setImporting(true)}>
            Import LinkedIn connections
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
            Add person
          </Button>
        </Space>
      </Flex>

      <Card size="small">
        <Flex gap={8} wrap align="center">
          <Segmented
            value={view}
            onChange={(value) => patchParams({ view: value === 'reconnect' ? 'reconnect' : null })}
            options={[
              { label: 'Everyone', value: 'all' },
              { label: 'Due a reconnect', value: 'reconnect' },
            ]}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Name, company, role or notes"
            style={{ maxWidth: 320 }}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              patchParams({ q: event.target.value || null });
            }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="How you know them"
            style={{ minWidth: 220 }}
            value={relationship}
            onChange={(value) => patchParams({ relationship: value })}
            options={RELATIONSHIPS.map((value) => ({ value, label: RELATIONSHIP_LABELS[value] }))}
          />
        </Flex>
      </Card>

      <Card size="small">
        <Table<ContactView>
          rowKey="id"
          size="middle"
          loading={isLoading}
          columns={columns}
          dataSource={data?.contacts ?? []}
          pagination={{
            pageSize,
            showSizeChanger: true,
            onChange: (_page, size) => setPageSize(size),
            hideOnSinglePage: pageSize === DEFAULT_PAGE_SIZE,
          }}
          onRow={(row) => ({
            onClick: () => navigate(`/people/${row.id}`),
            style: { cursor: 'pointer' },
          })}
          locale={{
            emptyText:
              view === 'reconnect'
                ? 'Nobody is due a reconnect'
                : debounced || relationship.length > 0
                  ? 'Nobody matches that'
                  : 'No people yet. Add someone, or import your LinkedIn connections.',
          }}
        />
      </Card>

      <ContactDrawer open={adding} onClose={() => setAdding(false)} onSaved={(contact) => navigate(`/people/${contact.id}`)} />
      <LinkedInImportModal open={importing} onClose={() => setImporting(false)} />
    </Space>
  );
}
