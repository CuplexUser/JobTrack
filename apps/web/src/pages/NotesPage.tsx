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
import { useTranslation } from 'react-i18next';
import type { NoteTarget, NoteWithTarget } from '@jobtrack/shared';
import { useDeleteNote, useNotes } from '../api/hooks.js';
import { NoteModal } from '../components/NoteModal.js';
import { parse, usePreference } from '../preferences.js';

type Scope = 'all' | NoteTarget;

export function NotesPage() {
  const { t } = useTranslation('notes');
  const { message } = AntApp.useApp();
  const [scope, setScope] = usePreference<Scope>('filters', 'notes.scope', 'all', parse.oneOf(['all', 'standalone', 'company', 'application']));
  const [query, setQuery] = usePreference('filters', 'notes.search', '', parse.string);
  const [editing, setEditing] = useState<NoteWithTarget | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useNotes(scope === 'all' ? {} : { targetType: scope });
  const remove = useDeleteNote();

  // Keyed on `data` rather than on a `data?.notes ?? []` read outside: that fallback is a
  // new empty array on every render, which is a dependency that never compares equal.
  const notes = useMemo(() => {
    const allNotes = data?.notes ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return allNotes;
    return allNotes.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) ||
        note.body.toLowerCase().includes(needle) ||
        (note.targetLabel?.toLowerCase().includes(needle) ?? false),
    );
  }, [data, query]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={12}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('page.title')}
        </Typography.Title>
        <Space>
          <Segmented
            value={scope}
            onChange={(value) => setScope(value as Scope)}
            options={[
              { label: t('page.scopeAll'), value: 'all' },
              { label: t('page.scopeStandalone'), value: 'standalone' },
              { label: t('page.scopeCompany'), value: 'company' },
              { label: t('page.scopeApplication'), value: 'application' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('page.newNote')}
          </Button>
        </Space>
      </Flex>

      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder={t('page.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <Card size="small" loading={isLoading}>
        {notes.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={query ? t('page.emptySearch', { query }) : t('page.emptyNone')}
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
                    title={t('page.deleteConfirmTitle')}
                    okText={t('page.delete')}
                    okButtonProps={{ danger: true }}
                    onConfirm={async () => {
                      await remove.mutateAsync(note.id);
                      message.success(t('page.deletedMessage'));
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
  const { t } = useTranslation('notes');
  if (note.targetType === 'standalone') return <Tag>{t('page.targetGeneral')}</Tag>;
  if (!note.targetId) return <Tag>{t('page.targetUnlinked')}</Tag>;

  const to =
    note.targetType === 'company' ? `/companies/${note.targetId}` : `/applications/${note.targetId}`;

  return (
    <Link to={to}>
      <Tag color="blue">
        {t(`page.targetType.${note.targetType}`)}: {note.targetLabel ?? t('page.targetView')}
      </Tag>
    </Link>
  );
}
