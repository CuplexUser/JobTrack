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
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, PushpinFilled } from '@ant-design/icons';
import type { NoteTarget, NoteWithTarget } from '@jobtrack/shared';
import { useApplications, useCompanies, useDeleteNote, useNotes, useSaveNote } from '../api/hooks.js';

type Scope = 'all' | NoteTarget;

export function NotesPage() {
  const { message } = AntApp.useApp();
  const [scope, setScope] = useState<Scope>('all');
  const [editing, setEditing] = useState<NoteWithTarget | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useNotes(scope === 'all' ? {} : { targetType: scope });
  const remove = useDeleteNote();

  const notes = data?.notes ?? [];

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

      <Card size="small" loading={isLoading}>
        {notes.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notes here yet" />
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

interface NoteFormValues {
  title: string;
  body: string;
  targetType: NoteTarget;
  targetId?: string | null;
  pinned: boolean;
}

function NoteModal({
  open,
  note,
  onClose,
}: {
  open: boolean;
  note: NoteWithTarget | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<NoteFormValues>();
  const { message } = AntApp.useApp();
  const save = useSaveNote();

  // Watched so the target picker can switch between companies and applications.
  const targetType = Form.useWatch('targetType', form) ?? 'standalone';

  const { data: companyData } = useCompanies();
  const { data: applicationData } = useApplications({ limit: 200 });

  const targetOptions = useMemo(() => {
    if (targetType === 'company') {
      return (companyData?.companies ?? []).map((c) => ({ value: c.id, label: c.name }));
    }
    if (targetType === 'application') {
      return (applicationData?.items ?? []).map((a) => ({
        value: a.id,
        label: `${a.jobTitle} — ${a.company.name}`,
      }));
    }
    return [];
  }, [targetType, companyData, applicationData]);

  return (
    <Modal
      open={open}
      title={note ? 'Edit note' : 'New note'}
      okText="Save"
      destroyOnHidden
      onCancel={onClose}
      afterOpenChange={(visible) => {
        if (!visible) return;
        if (note) {
          form.setFieldsValue({
            title: note.title,
            body: note.body,
            targetType: note.targetType,
            targetId: note.targetId,
            pinned: note.pinned,
          });
        } else {
          form.resetFields();
          form.setFieldsValue({ targetType: 'standalone', pinned: false, body: '' });
        }
      }}
      onOk={async () => {
        const values = await form.validateFields();
        await save.mutateAsync({
          ...(note ? { id: note.id } : {}),
          body: {
            title: values.title,
            body: values.body ?? '',
            targetType: values.targetType,
            targetId: values.targetType === 'standalone' ? null : (values.targetId ?? null),
            pinned: values.pinned ?? false,
          },
        });
        message.success(note ? 'Note updated' : 'Note saved');
        onClose();
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
          <Input placeholder="Interview prep, salary research…" />
        </Form.Item>

        <Form.Item name="body" label="Note">
          <Input.TextArea rows={8} placeholder="Anything worth keeping" />
        </Form.Item>

        <Flex gap={12}>
          <Form.Item name="targetType" label="Attach to" style={{ flex: 1 }}>
            <Select
              options={[
                { value: 'standalone', label: 'Nothing in particular' },
                { value: 'company', label: 'A company' },
                { value: 'application', label: 'An application' },
              ]}
              onChange={() => form.setFieldValue('targetId', null)}
            />
          </Form.Item>

          {targetType !== 'standalone' && (
            <Form.Item
              name="targetId"
              label={targetType === 'company' ? 'Company' : 'Application'}
              style={{ flex: 2 }}
              rules={[{ required: true, message: 'Pick what this note is about' }]}
            >
              <Select showSearch optionFilterProp="label" options={targetOptions} />
            </Form.Item>
          )}
        </Flex>

        <Form.Item name="pinned" label="Pinned" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
