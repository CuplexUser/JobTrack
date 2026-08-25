/**
 * The new/edit form for a saved opening.
 *
 * Deliberately smaller than `ApplicationDrawer`: no status, no tags, no live duplicate
 * check — an opening is a placeholder for something you have not committed to yet, so it
 * should take less effort to capture than a real application does.
 */

import { useEffect, useMemo } from 'react';
import { App as AntApp, AutoComplete, Button, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Space, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { WORK_MODES, WORK_MODE_LABELS, type JobOpeningView } from '@jobtrack/shared';
import { useCompanySuggestions, useCreateOpening, useUpdateOpening } from '../api/hooks.js';
import { ApiError } from '../api/client.js';

export interface OpeningDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  opening?: JobOpeningView | undefined;
}

interface FormValues {
  companyName: string;
  jobTitle: string;
  savedOn: Dayjs;
  jobUrl?: string;
  location?: string;
  workMode: string;
  sourceName?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
  notes?: string;
}

export function OpeningDrawer({ open, onClose, opening }: OpeningDrawerProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = AntApp.useApp();
  const isEdit = Boolean(opening);

  const create = useCreateOpening();
  const update = useUpdateOpening();

  const companyName = Form.useWatch('companyName', form) ?? '';
  const { data: suggestions } = useCompanySuggestions(companyName);

  useEffect(() => {
    if (!open) return;
    if (opening) {
      form.setFieldsValue({
        companyName: opening.company.name,
        jobTitle: opening.jobTitle,
        savedOn: dayjs(opening.savedOn),
        jobUrl: opening.jobUrl ?? undefined,
        location: opening.location ?? undefined,
        workMode: opening.workMode,
        sourceName: opening.sourceName ?? undefined,
        salaryMin: opening.salaryMin,
        salaryMax: opening.salaryMax,
        salaryCurrency: opening.salaryCurrency ?? undefined,
        notes: opening.notes ?? undefined,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ savedOn: dayjs(), workMode: 'unspecified' });
    }
  }, [open, opening, form]);

  const companyOptions = useMemo(
    () => (suggestions?.companies ?? []).map((company) => ({ value: company.name })),
    [suggestions],
  );

  async function handleSubmit(values: FormValues): Promise<void> {
    const payload = {
      companyName: values.companyName,
      jobTitle: values.jobTitle,
      jobUrl: values.jobUrl ?? null,
      location: values.location ?? null,
      workMode: values.workMode,
      sourceName: values.sourceName ?? null,
      salaryMin: values.salaryMin ?? null,
      salaryMax: values.salaryMax ?? null,
      salaryCurrency: values.salaryCurrency ?? null,
      notes: values.notes ?? null,
      ...(isEdit ? {} : { savedOn: values.savedOn.format('YYYY-MM-DD') }),
    };

    try {
      if (opening) {
        await update.mutateAsync({ id: opening.id, body: payload });
        message.success('Opening updated');
      } else {
        await create.mutateAsync(payload);
        message.success('Opening saved');
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.length > 0) {
        form.setFields(
          error.fieldErrors.map((issue) => ({
            name: issue.path.split('.') as unknown as keyof FormValues,
            errors: [issue.message],
          })),
        );
        message.error('Please check the highlighted fields');
      } else {
        message.error(error instanceof Error ? error.message : 'Could not save');
      }
    }
  }

  return (
    <Drawer
      title={isEdit ? 'Edit opening' : 'Save opening for later'}
      open={open}
      onClose={onClose}
      width={560}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={create.isPending || update.isPending} onClick={() => form.submit()}>
            {isEdit ? 'Save changes' : 'Save opening'}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        For a role you found but are not ready to apply to yet — no status, no tags, just
        enough to find it again. Convert it into a real application when you are ready.
      </Typography.Paragraph>

      <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark="optional">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="companyName" label="Company" rules={[{ required: true, message: 'Company is required' }]}>
              <AutoComplete options={companyOptions} placeholder="Start typing — existing companies appear" filterOption={false} allowClear />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="jobTitle" label="Job title" rules={[{ required: true, message: 'Job title is required' }]}>
              <Input placeholder="Backend Engineer" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="savedOn" label="Found on" rules={[{ required: true, message: 'Date is required' }]}>
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" disabled={isEdit} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="workMode" label="Work mode">
              <Select options={WORK_MODES.map((m) => ({ value: m, label: WORK_MODE_LABELS[m] }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="location" label="Location">
              <Input placeholder="Stockholm" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="salaryMin" label="Salary from">
              <InputNumber style={{ width: '100%' }} min={0} step={10000} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="salaryMax" label="Salary to">
              <InputNumber style={{ width: '100%' }} min={0} step={10000} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="salaryCurrency" label="Currency">
              <Input placeholder="SEK" maxLength={8} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="sourceName" label="Source">
          <Input placeholder="LinkedIn, referral…" />
        </Form.Item>

        <Form.Item name="jobUrl" label="Job posting URL">
          <Input placeholder="https://…" />
        </Form.Item>

        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={4} placeholder="Why this looked interesting, what you're missing to apply…" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
