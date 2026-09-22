/**
 * The new/edit form for a saved opening.
 *
 * Deliberately smaller than `ApplicationDrawer`: no status, no tags, no live duplicate
 * check — an opening is a placeholder for something you have not committed to yet, so it
 * should take less effort to capture than a real application does.
 */

import { useEffect, useMemo } from 'react';
import { App as AntApp, AutoComplete, Button, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import {
  WORK_MODES,
  WORK_MODE_LABELS,
  type JobOpeningView,
  type PostingDraft,
} from '@jobtrack/shared';
import { useCompanySuggestions, useCreateOpening, useUpdateOpening } from '../api/hooks.js';
import { ApiError } from '../api/client.js';

export interface OpeningDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  opening?: JobOpeningView | undefined;
  /**
   * A parsed posting to start from — what "Save from posting" hands over. The form is the
   * same one either way; capture only changes where the first values came from, and every
   * one of them stays editable, because a parsed draft is a guess.
   */
  draft?: PostingDraft | undefined;
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

export function OpeningDrawer({ open, onClose, opening, draft }: OpeningDrawerProps) {
  const { t } = useTranslation('openings');
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
      form.setFieldsValue({
        savedOn: dayjs(),
        workMode: draft?.workMode ?? 'unspecified',
        ...(draft
          ? {
              companyName: draft.companyName,
              jobTitle: draft.jobTitle,
              jobUrl: draft.jobUrl ?? undefined,
              location: draft.location ?? undefined,
              sourceName: draft.sourceName ?? undefined,
              salaryMin: draft.salaryMin,
              salaryMax: draft.salaryMax,
              salaryCurrency: draft.salaryCurrency ?? undefined,
              notes: draft.notes ?? undefined,
            }
          : {}),
      });
    }
  }, [open, opening, draft, form]);

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
        message.success(t('drawer.updatedMessage'));
      } else {
        await create.mutateAsync(payload);
        message.success(t('drawer.savedMessage'));
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
        message.error(t('drawer.validationError'));
      } else {
        message.error(error instanceof Error ? error.message : t('drawer.saveError'));
      }
    }
  }

  return (
    <Drawer
      title={isEdit ? t('drawer.editTitle') : t('drawer.createTitle')}
      open={open}
      onClose={onClose}
      width={560}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>{t('drawer.cancel')}</Button>
          <Button type="primary" loading={create.isPending || update.isPending} onClick={() => form.submit()}>
            {isEdit ? t('drawer.saveChanges') : t('drawer.saveOpening')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        {draft && !isEdit ? t('drawer.draftNote') : t('drawer.manualNote')}
      </Typography.Paragraph>

      <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark="optional">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="companyName" label={t('drawer.companyLabel')} rules={[{ required: true, message: t('drawer.companyRequired') }]}>
              <AutoComplete options={companyOptions} placeholder={t('drawer.companyPlaceholder')} filterOption={false} allowClear />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="jobTitle" label={t('drawer.jobTitleLabel')} rules={[{ required: true, message: t('drawer.jobTitleRequired') }]}>
              <Input placeholder={t('drawer.jobTitlePlaceholder')} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="savedOn" label={t('drawer.savedOnLabel')} rules={[{ required: true, message: t('drawer.dateRequired') }]}>
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" disabled={isEdit} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="workMode" label={t('drawer.workModeLabel')}>
              <Select options={WORK_MODES.map((m) => ({ value: m, label: WORK_MODE_LABELS[m] }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="location" label={t('drawer.locationLabel')}>
              <Input placeholder={t('drawer.locationPlaceholder')} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="salaryMin" label={t('drawer.salaryMinLabel')}>
              <InputNumber style={{ width: '100%' }} min={0} step={10000} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="salaryMax" label={t('drawer.salaryMaxLabel')}>
              <InputNumber style={{ width: '100%' }} min={0} step={10000} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="salaryCurrency" label={t('drawer.currencyLabel')}>
              <Input placeholder={t('drawer.currencyPlaceholder')} maxLength={8} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="sourceName" label={t('drawer.sourceLabel')}>
          <Input placeholder={t('drawer.sourcePlaceholder')} />
        </Form.Item>

        <Form.Item name="jobUrl" label={t('drawer.jobUrlLabel')}>
          <Input placeholder={t('drawer.jobUrlPlaceholder')} />
        </Form.Item>

        <Form.Item name="notes" label={t('drawer.notesLabel')}>
          <Input.TextArea rows={4} placeholder={t('drawer.notesPlaceholder')} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
