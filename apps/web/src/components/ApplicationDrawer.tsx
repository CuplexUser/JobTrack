/**
 * The new/edit application form.
 *
 * Two things make this more than a CRUD form:
 *
 * 1. The company field is an autocomplete over companies you already track, so a second
 *    spelling never gets created by accident.
 * 2. The duplicate check runs *while you type*, debounced, and an exact match demands a
 *    confirmation before it will save.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  AutoComplete,
  Button,
  Col,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  shouldBlockSave,
  type JobApplicationDetail,
} from '@jobtrack/shared';
import {
  useCompanySuggestions,
  useCreateApplication,
  useDuplicateCheck,
  useTags,
  useUpdateApplication,
} from '../api/hooks.js';
import { ApiError } from '../api/client.js';
import { DuplicateAlert } from './DuplicateAlert.js';
import { useDebounced } from '../hooks/useDebounced.js';

export interface ApplicationDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  application?: JobApplicationDetail | undefined;
}

interface FormValues {
  companyName: string;
  jobTitle: string;
  appliedOn: Dayjs;
  status: string;
  jobUrl?: string;
  location?: string;
  workMode: string;
  sourceName?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
  followUpOn?: Dayjs | null;
  tags: string[];
  notes?: string;
}

export function ApplicationDrawer({ open, onClose, application }: ApplicationDrawerProps) {
  const { t } = useTranslation('applications');
  const [form] = Form.useForm<FormValues>();
  const { message, modal } = AntApp.useApp();
  const isEdit = Boolean(application);

  const create = useCreateApplication();
  const update = useUpdateApplication();
  const { data: tagData } = useTags();

  // Watched so the duplicate check reacts to typing rather than to blur.
  const companyName = Form.useWatch('companyName', form) ?? '';
  const jobTitle = Form.useWatch('jobTitle', form) ?? '';

  const debouncedCompany = useDebounced(companyName, 300);
  const debouncedTitle = useDebounced(jobTitle, 300);

  /**
   * Editing is not applying.
   *
   * The panel exists to stop you *before* you fill in a form you have already filled in
   * once, so on a record that already exists it has nothing to say until the company or
   * the title actually changes. Without this, opening Edit on one of a genuine pair of
   * duplicates greets you with a red "you have already applied for this exact role" about
   * the very record you are looking at — correct, useless, and alarming.
   */
  const unchangedEdit =
    isEdit &&
    companyName.trim() === (application?.company.name ?? '').trim() &&
    jobTitle.trim() === (application?.jobTitle ?? '').trim();

  const { data: suggestions } = useCompanySuggestions(debouncedCompany);
  const { data: duplicateCheck, isFetching: checking } = useDuplicateCheck({
    company: debouncedCompany,
    title: debouncedTitle,
    ...(application ? { excludeId: application.id } : {}),
    enabled: open && !unchangedEdit,
  });

  useEffect(() => {
    if (!open) return;
    if (application) {
      form.setFieldsValue({
        companyName: application.company.name,
        jobTitle: application.jobTitle,
        appliedOn: dayjs(application.appliedOn),
        status: application.status,
        jobUrl: application.jobUrl ?? undefined,
        location: application.location ?? undefined,
        workMode: application.workMode,
        sourceName: application.sourceName ?? undefined,
        salaryMin: application.salaryMin,
        salaryMax: application.salaryMax,
        salaryCurrency: application.salaryCurrency ?? undefined,
        followUpOn: application.followUpOn ? dayjs(application.followUpOn) : null,
        tags: application.tags.map((t) => t.name),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        appliedOn: dayjs(),
        status: 'applied',
        workMode: 'unspecified',
        tags: [],
      });
    }
  }, [open, application, form]);

  const companyOptions = useMemo(
    () =>
      (suggestions?.companies ?? []).map((company) => ({
        value: company.name,
        label: (
          <Space>
            <span>{company.name}</span>
            {company.applicationCount > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('drawer.applicationCount', { count: company.applicationCount })}
              </Typography.Text>
            )}
          </Space>
        ),
      })),
    [suggestions, t],
  );

  const tagOptions = useMemo(
    () => (tagData?.tags ?? []).map((tag) => ({ value: tag.name, label: tag.name })),
    [tagData],
  );

  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: FormValues): Promise<void> {
    // An exact duplicate is the one case worth interrupting for. Everything softer is
    // already visible in the alert above the form.
    if (duplicateCheck && shouldBlockSave(duplicateCheck.verdict) && !isEdit) {
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: t('drawer.exactDuplicateTitle'),
          content: (
            <Space direction="vertical">
              <Typography.Text>
                {t('drawer.exactDuplicateDetail', {
                  jobTitle: duplicateCheck.matches[0]?.jobTitle,
                  company: duplicateCheck.company?.name,
                  date: duplicateCheck.matches[0]?.appliedOn,
                })}
              </Typography.Text>
              <Typography.Text type="secondary">{t('drawer.saveAnyway')}</Typography.Text>
            </Space>
          ),
          okText: t('drawer.saveAnywayOk'),
          cancelText: t('drawer.goBack'),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }

    const payload = {
      companyName: values.companyName,
      jobTitle: values.jobTitle,
      appliedOn: values.appliedOn.format('YYYY-MM-DD'),
      status: values.status,
      jobUrl: values.jobUrl ?? null,
      location: values.location ?? null,
      workMode: values.workMode,
      sourceName: values.sourceName ?? null,
      salaryMin: values.salaryMin ?? null,
      salaryMax: values.salaryMax ?? null,
      salaryCurrency: values.salaryCurrency ?? null,
      followUpOn: values.followUpOn ? values.followUpOn.format('YYYY-MM-DD') : null,
      tags: values.tags ?? [],
      ...(isEdit ? {} : { notes: values.notes ?? null }),
    };

    setSubmitting(true);
    try {
      if (application) {
        await update.mutateAsync({ id: application.id, body: payload });
        message.success(t('drawer.updatedMessage'));
      } else {
        await create.mutateAsync(payload);
        message.success(t('drawer.savedMessage'));
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.length > 0) {
        // Push server-side validation back onto the fields it belongs to.
        form.setFields(
          error.fieldErrors.map((issue) => ({
            // The server names a path like "salaryMin"; Form types this as a tuple union,
            // which a runtime-derived string array cannot satisfy statically.
            name: issue.path.split('.') as unknown as keyof FormValues,
            errors: [issue.message],
          })),
        );
        message.error(t('drawer.checkFieldsError'));
      } else {
        message.error(error instanceof Error ? error.message : t('drawer.saveError'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      title={isEdit ? t('drawer.editTitle') : t('drawer.newTitle')}
      open={open}
      onClose={onClose}
      width={640}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>{t('drawer.cancel')}</Button>
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            {isEdit ? t('drawer.saveChanges') : t('drawer.saveNew')}
          </Button>
        </Space>
      }
    >
      {/* Above the fields on purpose: the warning has to arrive before the effort does. */}
      {!unchangedEdit && <DuplicateAlert check={duplicateCheck} loading={checking} />}

      <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark="optional">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="companyName"
              label={t('drawer.fields.company')}
              rules={[{ required: true, message: t('drawer.rules.companyRequired') }]}
            >
              <AutoComplete
                options={companyOptions}
                placeholder={t('drawer.companyPlaceholder')}
                filterOption={false}
                allowClear
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="jobTitle"
              label={t('drawer.fields.jobTitle')}
              rules={[{ required: true, message: t('drawer.rules.jobTitleRequired') }]}
            >
              <Input placeholder={t('drawer.jobTitlePlaceholder')} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item
              name="appliedOn"
              label={t('drawer.fields.appliedOn')}
              rules={[{ required: true, message: t('drawer.rules.dateRequired') }]}
            >
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="status" label={t('drawer.fields.status')}>
              <Select
                options={APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="followUpOn" label={t('drawer.fields.followUpOn')}>
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="workMode" label={t('drawer.fields.workMode')}>
              <Select options={WORK_MODES.map((m) => ({ value: m, label: WORK_MODE_LABELS[m] }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="location" label={t('drawer.fields.location')}>
              <Input placeholder={t('drawer.locationPlaceholder')} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="sourceName" label={t('drawer.fields.source')}>
              <Input placeholder={t('drawer.sourcePlaceholder')} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="salaryMin" label={t('drawer.fields.salaryFrom')}>
              <InputNumber style={{ width: '100%' }} min={0} step={10000} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="salaryMax" label={t('drawer.fields.salaryTo')}>
              <InputNumber style={{ width: '100%' }} min={0} step={10000} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="salaryCurrency" label={t('drawer.fields.currency')}>
              <Input placeholder={t('drawer.currencyPlaceholder')} maxLength={8} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="jobUrl" label={t('drawer.fields.jobUrl')}>
          <Input placeholder={t('drawer.jobUrlPlaceholder')} />
        </Form.Item>

        <Form.Item name="tags" label={t('drawer.fields.tags')}>
          <Select
            mode="tags"
            options={tagOptions}
            placeholder={t('drawer.tagsPlaceholder')}
            tokenSeparators={[',']}
          />
        </Form.Item>

        {!isEdit && (
          <Form.Item
            name="notes"
            label={t('drawer.fields.notes')}
            help={t('drawer.notesHelp')}
          >
            <Input.TextArea rows={4} placeholder={t('drawer.notesPlaceholder')} />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  );
}
