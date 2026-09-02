/**
 * The duplicates sweep: everything already in the database that looks entered twice.
 *
 * The form's live check stops most repeats before they exist; this page is for the ones
 * that got in anyway — an import run twice, a browser extension clip saved from two tabs.
 *
 * Nothing is deleted without a choice. Each group picks a record to keep (the one furthest
 * along, then the fullest), and the rest are shown as what would go — a decision the page
 * makes visible rather than a cleanup it performs quietly. A group that is not actually a
 * duplicate can be dismissed for the session instead.
 *
 * The bulk button deliberately covers only the exact repeats. A similar-title group is a
 * judgment call — "Software Engineer" in 2025 and "Senior Software Engineer" in 2026 at one
 * employer are two real applications — so those are deleted one group at a time or not at all.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Popconfirm,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { WORK_MODE_LABELS, type JobApplicationView } from '@jobtrack/shared';
import { useDeleteApplications, useDuplicateGroups } from '../api/hooks.js';
import { StatusTag } from '../components/StatusTag.js';
import type { DuplicateGroupResponse } from '../api/client.js';

/** Stable across refetches, so a chosen keeper survives the list reloading. */
function groupKey(group: DuplicateGroupResponse): string {
  return [...group.members.map((m) => m.id)].sort().join('|');
}

export function DuplicatesPage() {
  const { message } = AntApp.useApp();
  const { data, isLoading, isFetching, refetch } = useDuplicateGroups();
  const remove = useDeleteApplications();

  /** Group key -> the id to keep. Absent means "whatever the scan recommended". */
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  /** Groups the user said are not duplicates. Session-only: nothing is written back. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => (data?.groups ?? []).filter((group) => !dismissed.has(groupKey(group))),
    [data, dismissed],
  );

  const keptId = (group: DuplicateGroupResponse): string =>
    keepers[groupKey(group)] ?? group.keepId;

  const removalIds = (group: DuplicateGroupResponse): string[] =>
    group.members.filter((member) => member.id !== keptId(group)).map((member) => member.id);

  const exactGroups = groups.filter((group) => group.kind === 'exact');
  const similarCount = groups.length - exactGroups.length;
  const bulkRemovals = exactGroups.flatMap(removalIds);

  async function removeIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      const result = await remove.mutateAsync(ids);
      message.success(
        `Removed ${result.deleted} application${result.deleted === 1 ? '' : 's'}`,
      );
    } catch {
      message.error('Could not remove those applications');
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={12}>
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Duplicates
          </Typography.Title>
          <Typography.Text type="secondary">
            {isLoading
              ? 'Scanning…'
              : [
                  `${data?.scanned ?? 0} application${data?.scanned === 1 ? '' : 's'} scanned`,
                  `${exactGroups.length} exact repeat${exactGroups.length === 1 ? '' : 's'}`,
                  ...(similarCount > 0 ? [`${similarCount} similar to review`] : []),
                ].join(' · ')}
          </Typography.Text>
        </Space>

        <Space>
          <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => void refetch()}>
            Rescan
          </Button>
          <Popconfirm
            title={`Delete ${bulkRemovals.length} application${bulkRemovals.length === 1 ? '' : 's'}?`}
            description="The kept record in each group stays. This cannot be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            disabled={bulkRemovals.length === 0}
            onConfirm={() => void removeIds(bulkRemovals)}
          >
            <Button
              danger
              type="primary"
              icon={<DeleteOutlined />}
              disabled={bulkRemovals.length === 0}
              loading={remove.isPending}
            >
              Remove {bulkRemovals.length} exact repeat{bulkRemovals.length === 1 ? '' : 's'}
            </Button>
          </Popconfirm>
        </Space>
      </Flex>

      {isLoading && <Skeleton active />}

      {!isLoading && groups.length === 0 && (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              (data?.scanned ?? 0) === 0
                ? 'Nothing to scan yet'
                : 'No duplicates — every application is a distinct role or employer'
            }
          />
        </Card>
      )}

      {groups.map((group) => (
        <DuplicateGroupCard
          key={groupKey(group)}
          group={group}
          keptId={keptId(group)}
          busy={remove.isPending}
          onKeep={(id) => setKeepers((current) => ({ ...current, [groupKey(group)]: id }))}
          onDismiss={() =>
            setDismissed((current) => new Set(current).add(groupKey(group)))
          }
          onRemove={() => void removeIds(removalIds(group))}
        />
      ))}
    </Space>
  );
}

interface GroupCardProps {
  group: DuplicateGroupResponse;
  keptId: string;
  busy: boolean;
  onKeep: (id: string) => void;
  onDismiss: () => void;
  onRemove: () => void;
}

function DuplicateGroupCard({ group, keptId, busy, onKeep, onDismiss, onRemove }: GroupCardProps) {
  const removals = group.members.length - 1;

  const columns: ColumnsType<JobApplicationView> = [
    {
      title: 'Position',
      key: 'jobTitle',
      render: (_, row) => (
        <Space size={8} wrap>
          <Link to={`/applications/${row.id}`}>{row.jobTitle}</Link>
          {row.archived && <Tag>Archived</Tag>}
          {row.id === keptId ? <Tag color="green">Keep</Tag> : <Tag color="red">Remove</Tag>}
        </Space>
      ),
    },
    { title: 'Applied', dataIndex: 'appliedOn', width: 118 },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      render: (_, row) => <StatusTag status={row.status} />,
    },
    {
      title: 'Where',
      key: 'location',
      width: 200,
      render: (_, row) =>
        [row.location, WORK_MODE_LABELS[row.workMode]].filter(Boolean).join(' · ') || '—',
    },
    {
      title: 'Notes',
      key: 'noteCount',
      width: 80,
      render: (_, row) => (row.noteCount > 0 ? row.noteCount : '—'),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space size={8} wrap>
          <Typography.Text strong>{group.companyName}</Typography.Text>
          <Typography.Text type="secondary">{group.members[0]?.jobTitle}</Typography.Text>
          <Tag color={group.kind === 'exact' ? 'red' : 'orange'}>
            {group.kind === 'exact' ? 'same title' : 'similar title'}
          </Tag>
        </Space>
      }
      extra={
        <Space>
          <Button size="small" onClick={onDismiss}>
            Not a duplicate
          </Button>
          <Popconfirm
            title={`Delete ${removals} application${removals === 1 ? '' : 's'}?`}
            description="This cannot be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={onRemove}
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={busy}>
              Delete {removals}
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {group.kind === 'similar' && (
          <Alert
            type="warning"
            showIcon
            message="Close but not identical — two applications a year apart can look like this. Delete only if it really is the same job."
          />
        )}
        <Table<JobApplicationView>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={group.members}
          pagination={false}
          rowSelection={{
            type: 'radio',
            columnTitle: 'Keep',
            columnWidth: 60,
            selectedRowKeys: [keptId],
            onChange: (selected) => onKeep(String(selected[0])),
          }}
        />
      </Space>
    </Card>
  );
}
