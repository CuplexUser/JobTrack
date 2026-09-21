/**
 * How fit points are divided among the parts `scoreFit` checks. Advanced and rarely touched,
 * which is why it lives in its own card below the profile rather than inside it — most people
 * never need to open this.
 */

import { useEffect } from 'react';
import { App as AntApp, Button, Card, Col, Form, InputNumber, Row, Space, Typography } from 'antd';
import { DEFAULT_FIT_WEIGHTS, type FitWeights } from '@jobtrack/shared';
import { useFitWeights, useSaveFitWeights } from '../api/hooks.js';

const POINT_FIELDS: { name: keyof FitWeights; label: string }[] = [
  { name: 'title', label: 'Title match' },
  { name: 'summary', label: 'Summary comparison' },
  { name: 'location', label: 'Location' },
  { name: 'workMode', label: 'Work mode' },
  { name: 'salary', label: 'Salary' },
  { name: 'keywords', label: 'Wanted keywords' },
];

export function FitWeightsCard() {
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
      message.success('Fit weights saved. Saved openings are rescored the next time you view them.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save fit weights');
    }
  }

  return (
    <Card title="Fit scoring" loading={isLoading}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          How the 0-100 fit score on the Openings page divides its points, and how strict the
          summary comparison is. Most people never need to change this; it exists for when the
          default balance does not match what actually matters to you.
        </Typography.Paragraph>

        <Form form={form} layout="vertical" onFinish={handleFinish}>
          <Typography.Text strong>Points out of 100 for each match</Typography.Text>
          <Row gutter={12}>
            {POINT_FIELDS.map(({ name, label }) => (
              <Col key={name} xs={12} md={4}>
                <Form.Item name={name} label={label}>
                  <InputNumber style={{ width: '100%' }} min={0} max={100} />
                </Form.Item>
              </Col>
            ))}
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item
                name="excludedPenalty"
                label="Points lost per excluded keyword"
                tooltip="Taken off the earned share for each excluded keyword found in the posting"
              >
                <InputNumber style={{ width: '100%' }} min={0} max={100} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item
                name="semanticFloor"
                label="Summary similarity floor"
                tooltip="Cosine similarity at or below this earns nothing from the summary comparison"
              >
                <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.05} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item
                name="semanticCeiling"
                label="Summary similarity ceiling"
                tooltip="Cosine similarity at or above this earns full marks from the summary comparison"
              >
                <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.05} />
              </Form.Item>
            </Col>
          </Row>

          <Space>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              Save fit weights
            </Button>
            <Button onClick={() => form.setFieldsValue(DEFAULT_FIT_WEIGHTS)}>Reset to defaults</Button>
          </Space>
        </Form>
      </Space>
    </Card>
  );
}
