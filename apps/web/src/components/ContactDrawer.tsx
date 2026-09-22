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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('contacts');
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

  /* oxlint-disable react-hooks/exhaustive-deps -- the primitives above are the dependencies
     on purpose; the objects they come from are not. */
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
  /* oxlint-enable react-hooks/exhaustive-deps */

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
      message.success(contact ? t('form.updateSuccess') : t('form.addSuccess'));
      onSaved?.(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.length > 0) {
        form.setFields(error.fieldErrors.map((field) => ({ name: field.path as never, errors: [field.message] })));
      } else {
        message.error(error instanceof Error ? error.message : t('form.saveError'));
      }
    }
  }

  return (
    <Drawer
      title={contact ? t('form.editTitle', { name: contact.name }) : t('form.addTitle')}
      open={open}
      onClose={onClose}
      width={560}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>{t('form.cancel')}</Button>
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            {t('form.save')}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark="optional">
        <Form.Item name="name" label={t('form.name.label')} rules={[{ required: true, message: t('form.name.required') }]}>
          {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- the drawer opens on a click
              or a keystroke, and the name is the field it opened to collect. */}
          <Input autoFocus placeholder={t('form.name.placeholder')} />
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="companyName" label={t('form.companyName.label')}>
              <AutoComplete options={companyOptions} placeholder={t('form.companyName.placeholder')} filterOption={false} allowClear />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="headline" label={t('form.headline.label')}>
              <Input placeholder={t('form.headline.placeholder')} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="relationship" label={t('form.relationship.label')}>
              <Select options={RELATIONSHIPS.map((value) => ({ value, label: RELATIONSHIP_LABELS[value] }))} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="reconnectOn"
              label={t('form.reconnectOn.label')}
              tooltip={t('form.reconnectOn.tooltip')}
            >
              <DatePicker
                style={{ width: '100%' }}
                format="YYYY-MM-DD"
                presets={[
                  { label: t('form.reconnectOn.presets.week'), value: dayjs().add(1, 'week') },
                  { label: t('form.reconnectOn.presets.month'), value: dayjs().add(1, 'month') },
                  { label: t('form.reconnectOn.presets.threeMonths'), value: dayjs().add(3, 'month') },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="email" label={t('form.email.label')} rules={[{ type: 'email', message: t('form.email.invalid') }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="phone" label={t('form.phone.label')}>
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="linkedinUrl" label={t('form.linkedinUrl.label')}>
          <Input placeholder={t('form.linkedinUrl.placeholder')} />
        </Form.Item>

        <Form.Item name="about" label={t('form.about.label')}>
          <Input.TextArea rows={5} placeholder={t('form.about.placeholder')} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
