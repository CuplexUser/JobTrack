/**
 * What the user is looking for. Saved openings are ranked against it on the Openings page.
 *
 * Every field is optional and an empty one is simply not scored, so a profile can start as a
 * couple of job titles and grow. The summary is compared by meaning, which is why it takes a
 * pasted CV as happily as a few lines.
 */

import { useEffect } from 'react';
import { App as AntApp, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { WORK_MODES, WORK_MODE_LABELS, type LocationTier, type Profile, type WorkMode } from '@jobtrack/shared';
import { useProfile, useSaveProfile } from '../api/hooks.js';
import { LocationTiersInput } from './LocationTiersInput.js';

interface FormValues {
  summary?: string;
  targetTitles: string[];
  locationTiers: LocationTier[];
  workModes: WorkMode[];
  salaryFloor?: number | null;
  salaryCurrency?: string;
  includeKeywords: string[];
  excludeKeywords: string[];
}

/** A free-typed list: press Enter or type a comma to add an entry. */
function ListInput({ placeholder, ...props }: { placeholder: string; value?: string[]; onChange?: (value: string[]) => void }) {
  return <Select mode="tags" open={false} tokenSeparators={[',']} placeholder={placeholder} suffixIcon={null} {...props} />;
}

export function ProfileCard() {
  const { t } = useTranslation('settings');
  const [form] = Form.useForm<FormValues>();
  const { message } = AntApp.useApp();
  const { data, isLoading } = useProfile();
  const save = useSaveProfile();

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      summary: data.summary ?? undefined,
      targetTitles: data.targetTitles,
      locationTiers: data.locationTiers,
      workModes: data.workModes,
      salaryFloor: data.salaryFloor,
      salaryCurrency: data.salaryCurrency ?? undefined,
      includeKeywords: data.includeKeywords,
      excludeKeywords: data.excludeKeywords,
    });
  }, [data, form]);

  async function handleFinish(values: FormValues): Promise<void> {
    const body: Profile = {
      summary: values.summary?.trim() || null,
      targetTitles: values.targetTitles ?? [],
      locationTiers: (values.locationTiers ?? []).filter((tier) => tier.places.length > 0),
      workModes: values.workModes ?? [],
      salaryFloor: values.salaryFloor ?? null,
      salaryCurrency: values.salaryCurrency?.trim() || null,
      includeKeywords: values.includeKeywords ?? [],
      excludeKeywords: values.excludeKeywords ?? [],
    };
    try {
      await save.mutateAsync(body);
      message.success(t('profile.saveSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('profile.saveError'));
    }
  }

  return (
    <Card title={t('profile.title')} loading={isLoading}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('profile.description')}
        </Typography.Paragraph>

        <Form form={form} layout="vertical" onFinish={handleFinish}>
          <Form.Item name="summary" label={t('profile.aboutYou.label')} tooltip={t('profile.aboutYou.tooltip')}>
            <Input.TextArea rows={6} placeholder={t('profile.aboutYou.placeholder')} />
          </Form.Item>

          <Form.Item name="targetTitles" label={t('profile.targetTitles.label')}>
            <ListInput placeholder={t('profile.targetTitles.placeholder')} />
          </Form.Item>

          <Form.Item name="locationTiers" label={t('profile.locationTiers.label')} tooltip={t('profile.locationTiers.tooltip')}>
            <LocationTiersInput />
          </Form.Item>

          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="workModes" label={t('profile.workModes.label')} tooltip={t('profile.workModes.tooltip')}>
                <Select
                  mode="multiple"
                  allowClear
                  placeholder={t('profile.workModes.placeholder')}
                  options={WORK_MODES.filter((mode) => mode !== 'unspecified').map((mode) => ({
                    value: mode,
                    label: WORK_MODE_LABELS[mode],
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={16} md={8}>
              <Form.Item name="salaryFloor" label={t('profile.salaryFloor.label')}>
                <InputNumber style={{ width: '100%' }} min={0} step={10000} placeholder={t('profile.salaryFloor.placeholder')} />
              </Form.Item>
            </Col>
            <Col xs={8} md={4}>
              <Form.Item name="salaryCurrency" label={t('profile.salaryCurrency.label')}>
                <Input placeholder={t('profile.salaryCurrency.placeholder')} maxLength={8} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="includeKeywords" label={t('profile.includeKeywords.label')}>
                <ListInput placeholder={t('profile.includeKeywords.placeholder')} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="excludeKeywords"
                label={t('profile.excludeKeywords.label')}
                tooltip={t('profile.excludeKeywords.tooltip')}
              >
                <ListInput placeholder={t('profile.excludeKeywords.placeholder')} />
              </Form.Item>
            </Col>
          </Row>

          <Button type="primary" htmlType="submit" loading={save.isPending}>
            {t('profile.saveButton')}
          </Button>
        </Form>
      </Space>
    </Card>
  );
}
