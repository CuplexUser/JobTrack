/**
 * Logging a conversation with someone.
 *
 * The reconnect date sits in the same form on purpose: "talked to her, check back in a
 * month" is one thought, and splitting it across two screens is how the second half gets
 * forgotten.
 */

import { useEffect } from 'react';
import { App as AntApp, DatePicker, Form, Input, Modal, Segmented, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { CHANNELS, CHANNEL_LABELS, type Channel, type Direction } from '@jobtrack/shared';
import { useLogInteraction } from '../api/hooks.js';

export interface InteractionModalProps {
  open: boolean;
  onClose: () => void;
  contact: { id: string; name: string } | null;
  /** Set when logging from an application page, so the conversation is recorded against it. */
  applicationId?: string;
}

interface FormValues {
  occurredOn: Dayjs;
  channel: Channel;
  direction: Direction;
  summary: string;
  reconnectOn?: Dayjs | null;
}

export function InteractionModal({ open, onClose, contact, applicationId }: InteractionModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = AntApp.useApp();
  const log = useLogInteraction();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ occurredOn: dayjs(), channel: 'linkedin', direction: 'outbound' });
  }, [open, form]);

  async function handleFinish(values: FormValues): Promise<void> {
    if (!contact) return;
    try {
      await log.mutateAsync({
        contactId: contact.id,
        body: {
          occurredOn: values.occurredOn.format('YYYY-MM-DD'),
          channel: values.channel,
          direction: values.direction,
          summary: values.summary,
          applicationId: applicationId ?? null,
          // Only move the reminder when a date was picked, so logging a chat never clears one.
          ...(values.reconnectOn ? { reconnectOn: values.reconnectOn.format('YYYY-MM-DD') } : {}),
        },
      });
      message.success('Logged');
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not log that');
    }
  }

  return (
    <Modal
      title={contact ? `Log a conversation with ${contact.name}` : ''}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Log it"
      confirmLoading={log.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item name="direction" label="Who reached out">
          <Segmented
            options={[
              { label: 'I did', value: 'outbound' },
              { label: 'They did', value: 'inbound' },
            ]}
          />
        </Form.Item>
        <Form.Item name="channel" label="How">
          <Select options={CHANNELS.map((value) => ({ value, label: CHANNEL_LABELS[value] }))} />
        </Form.Item>
        <Form.Item name="occurredOn" label="When" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>
        <Form.Item name="summary" label="What happened" rules={[{ required: true, message: 'Say what happened' }]}>
          <Input.TextArea rows={3} placeholder="Asked about the platform team; she offered to refer me" />
        </Form.Item>
        <Form.Item name="reconnectOn" label="Get back in touch on" tooltip="Optional. Sets their next reminder.">
          <DatePicker
            style={{ width: '100%' }}
            format="YYYY-MM-DD"
            presets={[
              { label: 'In a week', value: dayjs().add(1, 'week') },
              { label: 'In two weeks', value: dayjs().add(2, 'week') },
              { label: 'In a month', value: dayjs().add(1, 'month') },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
