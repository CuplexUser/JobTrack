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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('contacts');
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
      title: t('list.columns.name'),
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
      title: t('list.columns.worksAt'),
      dataIndex: 'companyName',
      width: 220,
      sorter: (a, b) => (a.companyName ?? '').localeCompare(b.companyName ?? ''),
    },
    {
      title: t('list.columns.relationship'),
      dataIndex: 'relationship',
      width: 170,
      render: (_, row) => <Tag>{RELATIONSHIP_LABELS[row.relationship]}</Tag>,
    },
    {
      title: t('list.columns.lastSpoke'),
      dataIndex: 'lastInteractionOn',
      width: 130,
      sorter: (a, b) => (a.lastInteractionOn ?? '').localeCompare(b.lastInteractionOn ?? ''),
      render: (value: string | null) => value ?? <Typography.Text type="secondary">{t('list.columns.lastSpokeNever')}</Typography.Text>,
    },
    {
      title: t('list.columns.reconnectOn'),
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
            {t('list.title')}
          </Typography.Title>
          <Typography.Text type="secondary">
            {view === 'reconnect' ? t('list.summary.reconnect', { count: total }) : t('list.summary.all', { count: total })}
          </Typography.Text>
        </Space>
        <Space wrap>
          <Button icon={<LinkedinOutlined />} onClick={() => setImporting(true)}>
            {t('list.importButton')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
            {t('list.addButton')}
          </Button>
        </Space>
      </Flex>

      <Card size="small">
        <Flex gap={8} wrap align="center">
          <Segmented
            value={view}
            onChange={(value) => patchParams({ view: value === 'reconnect' ? 'reconnect' : null })}
            options={[
              { label: t('list.filter.everyone'), value: 'all' },
              { label: t('list.filter.reconnect'), value: 'reconnect' },
            ]}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t('list.searchPlaceholder')}
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
            placeholder={t('list.relationshipPlaceholder')}
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
                ? t('list.emptyReconnect')
                : debounced || relationship.length > 0
                  ? t('list.emptyFiltered')
                  : t('list.emptyAll'),
          }}
        />
      </Card>

      <ContactDrawer open={adding} onClose={() => setAdding(false)} onSaved={(contact) => navigate(`/people/${contact.id}`)} />
      <LinkedInImportModal open={importing} onClose={() => setImporting(false)} />
    </Space>
  );
}
