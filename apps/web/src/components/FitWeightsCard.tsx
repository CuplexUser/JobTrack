/**
 * How fit points are divided among the parts `scoreFit` checks. Advanced and rarely touched,
 * which is why it lives in its own card below the profile rather than inside it — most people
 * never need to open this.
 */

import { useEffect } from 'react';
import { App as AntApp, Button, Card, Col, Form, InputNumber, Row, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { DEFAULT_FIT_WEIGHTS, type FitWeights } from '@jobtrack/shared';
import { useFitWeights, useSaveFitWeights } from '../api/hooks.js';

const POINT_FIELDS: { name: keyof FitWeights; labelKey: string }[] = [
  { name: 'title', labelKey: 'fitWeights.fields.title' },
  { name: 'summary', labelKey: 'fitWeights.fields.summary' },
  { name: 'location', labelKey: 'fitWeights.fields.location' },
  { name: 'workMode', labelKey: 'fitWeights.fields.workMode' },
  { name: 'salary', labelKey: 'fitWeights.fields.salary' },
  { name: 'keywords', labelKey: 'fitWeights.fields.keywords' },
];

export function FitWeightsCard() {
  const { t } = useTranslation('settings');
  const [form] = Form.useForm<FitWeights>();
  const { message } = AntApp.useApp();
  const { data, isLoading } = useFitWeights();
  const save = useSaveFitWeights();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  async function handleFinish(values: FitWeights): Promise<void> {
    try {
      await save.mutateAsync(values);
      message.success(t('fitWeights.saveSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('fitWeights.saveError'));
    }
  }

  return (
    <Card title={t('fitWeights.title')} loading={isLoading}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('fitWeights.description')}
        </Typography.Paragraph>

        <Form form={form} layout="vertical" onFinish={handleFinish}>
          <Typography.Text strong>{t('fitWeights.pointsHeading')}</Typography.Text>
          <Row gutter={12}>
            {POINT_FIELDS.map(({ name, labelKey }) => (
              <Col key={name} xs={12} md={4}>
                <Form.Item name={name} label={t(labelKey)}>
                  <InputNumber style={{ width: '100%' }} min={0} max={100} />
                </Form.Item>
              </Col>
            ))}
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item
                name="excludedPenalty"
                label={t('fitWeights.excludedPenalty.label')}
                tooltip={t('fitWeights.excludedPenalty.tooltip')}
              >
                <InputNumber style={{ width: '100%' }} min={0} max={100} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item
                name="semanticFloor"
                label={t('fitWeights.semanticFloor.label')}
                tooltip={t('fitWeights.semanticFloor.tooltip')}
              >
                <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.05} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item
                name="semanticCeiling"
                label={t('fitWeights.semanticCeiling.label')}
                tooltip={t('fitWeights.semanticCeiling.tooltip')}
              >
                <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.05} />
              </Form.Item>
            </Col>
          </Row>

          <Space>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              {t('fitWeights.saveButton')}
            </Button>
            <Button onClick={() => form.setFieldsValue(DEFAULT_FIT_WEIGHTS)}>{t('fitWeights.resetButton')}</Button>
          </Space>
        </Form>
      </Space>
    </Card>
  );
}
