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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('contacts');
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
      message.success(t('interaction.logSuccess'));
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('interaction.logError'));
    }
  }

  return (
    <Modal
      title={contact ? t('interaction.title', { name: contact.name }) : ''}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t('interaction.okText')}
      confirmLoading={log.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item name="direction" label={t('interaction.direction.label')}>
          <Segmented
            options={[
              { label: t('interaction.direction.outbound'), value: 'outbound' },
              { label: t('interaction.direction.inbound'), value: 'inbound' },
            ]}
          />
        </Form.Item>
        <Form.Item name="channel" label={t('interaction.channel.label')}>
          <Select options={CHANNELS.map((value) => ({ value, label: CHANNEL_LABELS[value] }))} />
        </Form.Item>
        <Form.Item name="occurredOn" label={t('interaction.occurredOn.label')} rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>
        <Form.Item name="summary" label={t('interaction.summary.label')} rules={[{ required: true, message: t('interaction.summary.required') }]}>
          <Input.TextArea rows={3} placeholder={t('interaction.summary.placeholder')} />
        </Form.Item>
        <Form.Item name="reconnectOn" label={t('interaction.reconnectOn.label')} tooltip={t('interaction.reconnectOn.tooltip')}>
          <DatePicker
            style={{ width: '100%' }}
            format="YYYY-MM-DD"
            presets={[
              { label: t('interaction.reconnectOn.presets.week'), value: dayjs().add(1, 'week') },
              { label: t('interaction.reconnectOn.presets.twoWeeks'), value: dayjs().add(2, 'week') },
              { label: t('interaction.reconnectOn.presets.month'), value: dayjs().add(1, 'month') },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
