/**
 * The new/edit form for a person in the network.
 *
 * Only the name is required, because a contact is often a name and an employer jotted down
 * after an event. The employer field suggests companies already in JobTrack, but anything
 * typed is kept as-is: a contact's employer does not have to be a company you track.
 */

import { useEffect, useMemo } from 'react';
import { App as AntApp, AutoComplete, Button, Col, DatePicker, Drawer, Form, Input, Row, Select, Space } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { RELATIONSHIPS, RELATIONSHIP_LABELS, type ContactView, type Relationship } from '@jobtrack/shared';
import { useCompanySuggestions, useSaveContact } from '../api/hooks.js';
import { ApiError } from '../api/client.js';

export interface ContactDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  contact?: ContactView | undefined;
  /** Starting values for a new person, such as the employer when adding from a company page. */
  defaults?: { companyName?: string; relationship?: Relationship };
  onSaved?: (contact: ContactView) => void;
}

interface FormValues {
  name: string;
  companyName?: string;
  headline?: string;
  relationship: Relationship;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  reconnectOn?: Dayjs | null;
  about?: string;
}

export function ContactDrawer({ open, onClose, contact, defaults, onSaved }: ContactDrawerProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = AntApp.useApp();
  const save = useSaveContact();

  const companyName = Form.useWatch('companyName', form) ?? '';
  const { data: suggestions } = useCompanySuggestions(companyName);
  const companyOptions = useMemo(
    () => (suggestions?.companies ?? []).map((company) => ({ value: company.name })),
    [suggestions],
  );

  // Keyed on primitives, not on `contact` or `defaults` themselves: callers pass `defaults`
  // as an inline object and a refetch hands back a new `contact`, and either would otherwise
  // reset the form under the user's fingers while they type.
  const contactId = contact?.id;
  const defaultCompany = defaults?.companyName;
  const defaultRelationship = defaults?.relationship;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (contact) {
      form.setFieldsValue({
        name: contact.name,
        companyName: contact.companyName ?? undefined,
        headline: contact.headline ?? undefined,
        relationship: contact.relationship,
        email: contact.email ?? undefined,
        phone: contact.phone ?? undefined,
        linkedinUrl: contact.linkedinUrl ?? undefined,
        reconnectOn: contact.reconnectOn ? dayjs(contact.reconnectOn) : null,
        about: contact.about ?? undefined,
      });
    } else {
      form.setFieldsValue({
        relationship: defaultRelationship ?? 'connection',
        companyName: defaultCompany,
      });
    }
  }, [open, contactId, defaultCompany, defaultRelationship, form]);

  async function handleFinish(values: FormValues): Promise<void> {
    const body = {
      name: values.name,
      companyName: values.companyName ?? null,
      headline: values.headline ?? null,
      relationship: values.relationship,
      email: values.email ?? null,
      phone: values.phone ?? null,
      linkedinUrl: values.linkedinUrl ?? null,
      reconnectOn: values.reconnectOn ? values.reconnectOn.format('YYYY-MM-DD') : null,
      about: values.about ?? null,
    };
    try {
      const saved = await save.mutateAsync({ id: contact?.id, body });
      message.success(contact ? 'Person updated' : 'Person added');
      onSaved?.(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.length > 0) {
        form.setFields(error.fieldErrors.map((field) => ({ name: field.path as never, errors: [field.message] })));
      } else {
        message.error(error instanceof Error ? error.message : 'Could not save');
      }
    }
  }

  return (
    <Drawer
      title={contact ? `Edit ${contact.name}` : 'Add a person'}
      open={open}
      onClose={onClose}
      width={560}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            Save
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark="optional">
        <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
          <Input autoFocus placeholder="Anna Svensson" />
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="companyName" label="Works at">
              <AutoComplete options={companyOptions} placeholder="Company" filterOption={false} allowClear />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="headline" label="Their role">
              <Input placeholder="Engineering Manager" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="relationship" label="How you know them">
              <Select options={RELATIONSHIPS.map((value) => ({ value, label: RELATIONSHIP_LABELS[value] }))} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="reconnectOn"
              label="Reconnect on"
              tooltip="Shows up on the dashboard when the day comes"
            >
              <DatePicker
                style={{ width: '100%' }}
                format="YYYY-MM-DD"
                presets={[
                  { label: 'In a week', value: dayjs().add(1, 'week') },
                  { label: 'In a month', value: dayjs().add(1, 'month') },
                  { label: 'In three months', value: dayjs().add(3, 'month') },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'That is not an email address' }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="phone" label="Phone">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="linkedinUrl" label="LinkedIn profile">
          <Input placeholder="https://www.linkedin.com/in/..." />
        </Form.Item>

        <Form.Item name="about" label="Notes">
          <Input.TextArea rows={5} placeholder="Where you met, what they work on, what you talked about" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
