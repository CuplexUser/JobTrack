/**
 * What the user is looking for. Saved openings are ranked against it on the Openings page.
 *
 * Every field is optional and an empty one is simply not scored, so a profile can start as a
 * couple of job titles and grow. The summary is compared by meaning, which is why it takes a
 * pasted CV as happily as a few lines.
 */

import { useEffect } from 'react';
import { App as AntApp, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Typography } from 'antd';
import { WORK_MODES, WORK_MODE_LABELS, type Profile, type WorkMode } from '@jobtrack/shared';
import { useProfile, useSaveProfile } from '../api/hooks.js';

interface FormValues {
  summary?: string;
  targetTitles: string[];
  locations: string[];
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
  const [form] = Form.useForm<FormValues>();
  const { message } = AntApp.useApp();
  const { data, isLoading } = useProfile();
  const save = useSaveProfile();

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      summary: data.summary ?? undefined,
      targetTitles: data.targetTitles,
      locations: data.locations,
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
      locations: values.locations ?? [],
      workModes: values.workModes ?? [],
      salaryFloor: values.salaryFloor ?? null,
      salaryCurrency: values.salaryCurrency?.trim() || null,
      includeKeywords: values.includeKeywords ?? [],
      excludeKeywords: values.excludeKeywords ?? [],
    };
    try {
      await save.mutateAsync(body);
      message.success('Profile saved. Openings are ranked against it.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save the profile');
    }
  }

  return (
    <Card title="Your profile" loading={isLoading}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          What you are looking for. The Openings page ranks saved openings against it and shows why
          each one scored as it did. Leave anything blank that does not matter to you.
        </Typography.Paragraph>

        <Form form={form} layout="vertical" onFinish={handleFinish}>
          <Form.Item
            name="summary"
            label="About you"
            tooltip="Compared with each posting by meaning, once the search model has loaded. A pasted CV works well."
          >
            <Input.TextArea rows={6} placeholder="Backend engineer, eight years in payments and data platforms. Kotlin, Postgres, Kafka." />
          </Form.Item>

          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="targetTitles" label="Job titles you want">
                <ListInput placeholder="Backend Engineer, Platform Engineer" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="locations" label="Places you would work">
                <ListInput placeholder="Stockholm, Uppsala" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="workModes" label="Work modes" tooltip="A remote role counts as in every location when you pick Remote">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Any"
                  options={WORK_MODES.filter((mode) => mode !== 'unspecified').map((mode) => ({
                    value: mode,
                    label: WORK_MODE_LABELS[mode],
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={16} md={8}>
              <Form.Item name="salaryFloor" label="Lowest salary you would take">
                <InputNumber style={{ width: '100%' }} min={0} step={10000} placeholder="Yearly" />
              </Form.Item>
            </Col>
            <Col xs={8} md={4}>
              <Form.Item name="salaryCurrency" label="Currency">
                <Input placeholder="SEK" maxLength={8} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="includeKeywords" label="Words that make a posting better">
                <ListInput placeholder="Kotlin, payments, on-call free" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="excludeKeywords" label="Words that rule a posting out" tooltip="Each one found takes a large share off the score">
                <ListInput placeholder="PHP, consultancy" />
              </Form.Item>
            </Col>
          </Row>

          <Button type="primary" htmlType="submit" loading={save.isPending}>
            Save profile
          </Button>
        </Form>
      </Space>
    </Card>
  );
}
