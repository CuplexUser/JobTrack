/**
 * The new/edit note form, shared by the notes page and by the record pages that show a
 * note list of their own.
 *
 * `target` is what makes it reusable: the notes page opens it unpinned, so the note can be
 * attached to anything, while an application or company page opens it already pointed at
 * that record — there is no picker to get wrong, and no way to accidentally reattach a
 * note to something else while editing it in place.
 */

import { useMemo } from 'react';
import type { FormInstance } from 'antd';
import { App as AntApp, Flex, Form, Input, Modal, Select, Switch, Typography } from 'antd';
import type { Note, NoteTarget } from '@jobtrack/shared';
import { useApplications, useCompanies, useSaveNote } from '../api/hooks.js';

/** A record a note can be pinned to — everything but `standalone`, which has no id. */
export interface NoteTargetRef {
  type: Exclude<NoteTarget, 'standalone'>;
  id: string;
  label: string;
}

export interface NoteModalProps {
  open: boolean;
  /** The note being edited; null when creating. */
  note: Note | null;
  onClose: () => void;
  /** Pins the note to one record and hides the target picker. */
  target?: NoteTargetRef | undefined;
}

interface NoteFormValues {
  title: string;
  body: string;
  targetType: NoteTarget;
  targetId?: string | null;
  pinned: boolean;
}

export function NoteModal({ open, note, onClose, target }: NoteModalProps) {
  const [form] = Form.useForm<NoteFormValues>();
  const { message } = AntApp.useApp();
  const save = useSaveNote();

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
          form.setFieldsValue({
            targetType: target ? target.type : 'standalone',
            targetId: target ? target.id : null,
            pinned: false,
            body: '',
          });
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

        {target ? (
          <>
            {/* Still form state — just not editable here, since the page it opened from is
                the answer to "attached to what?". */}
            <Form.Item name="targetType" hidden>
              <Input />
            </Form.Item>
            <Form.Item name="targetId" hidden>
              <Input />
            </Form.Item>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
              Attached to {target.label}
            </Typography.Paragraph>
          </>
        ) : (
          <TargetPicker form={form} />
        )}

        <Form.Item name="pinned" label="Pinned" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/**
 * The "attach to what?" pair of fields.
 *
 * Its own component so the company and application lists it needs are only fetched when
 * the picker is actually on screen — a page that opens this modal already pinned to one
 * record has no use for either list.
 */
function TargetPicker({ form }: { form: FormInstance<NoteFormValues> }) {
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
  );
}
