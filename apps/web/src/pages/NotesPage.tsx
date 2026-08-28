/**
 * Notes: standalone ones plus everything linked to a company or an application.
 *
 * Linking is the point — a note about an interview process belongs to the application it
 * came from, and a note about an employer belongs to the company, so both show up where
 * you would look for them rather than only in one long list.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  App as AntApp,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  List,
  Popconfirm,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PushpinFilled,
  SearchOutlined,
} from '@ant-design/icons';
import type { NoteTarget, NoteWithTarget } from '@jobtrack/shared';
import { useDeleteNote, useNotes } from '../api/hooks.js';
import { NoteModal } from '../components/NoteModal.js';

type Scope = 'all' | NoteTarget;

export function NotesPage() {
  const { message } = AntApp.useApp();
  const [scope, setScope] = useState<Scope>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<NoteWithTarget | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useNotes(scope === 'all' ? {} : { targetType: scope });
  const remove = useDeleteNote();

  const allNotes = data?.notes ?? [];
  const notes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allNotes;
    return allNotes.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) ||
        note.body.toLowerCase().includes(needle) ||
        (note.targetLabel?.toLowerCase().includes(needle) ?? false),
    );
  }, [allNotes, query]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={12}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Notes
        </Typography.Title>
        <Space>
          <Segmented
            value={scope}
            onChange={(value) => setScope(value as Scope)}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Standalone', value: 'standalone' },
              { label: 'Companies', value: 'company' },
              { label: 'Applications', value: 'application' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New note
          </Button>
        </Space>
      </Flex>

      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Search notes by title, body, or what they're attached to"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <Card size="small" loading={isLoading}>
        {notes.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={query ? `Nothing matched “${query}”` : 'No notes here yet'}
          />
        ) : (
          <List
            dataSource={notes}
            renderItem={(note) => (
              <List.Item
                actions={[
                  <Button
                    key="edit"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => setEditing(note)}
                  />,
                  <Popconfirm
                    key="delete"
                    title="Delete this note?"
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={async () => {
                      await remove.mutateAsync(note.id);
                      message.success('Note deleted');
                    }}
                  >
                    <Button type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={8} wrap>
                      {note.pinned && <PushpinFilled style={{ color: '#faad14' }} />}
                      <Typography.Text strong>{note.title}</Typography.Text>
                      <TargetTag note={note} />
                    </Space>
                  }
                  description={
                    <Typography.Paragraph
                      style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
                      ellipsis={{ rows: 3, expandable: true, symbol: 'more' }}
                    >
                      {note.body}
                    </Typography.Paragraph>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <NoteModal
        open={creating || editing !== null}
        note={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </Space>
  );
}

function TargetTag({ note }: { note: NoteWithTarget }) {
  if (note.targetType === 'standalone') return <Tag>general</Tag>;
  if (!note.targetId) return <Tag>unlinked</Tag>;

  const to =
    note.targetType === 'company' ? `/companies/${note.targetId}` : `/applications/${note.targetId}`;

  return (
    <Link to={to}>
      <Tag color="blue">
        {note.targetType}: {note.targetLabel ?? 'view'}
      </Tag>
    </Link>
  );
}
