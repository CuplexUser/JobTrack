/**
 * The job platforms or the job APIs the user searches, best first. Reference only: JobTrack
 * does not call any of them, but an assistant connected over MCP reads this list
 * (`get_job_sources`) to know where to search and in what order.
 *
 * One card per list, each saving only its own list, so tidying the platforms never
 * resends the APIs.
 */

import { useEffect } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Card, Col, Empty, Form, Input, Row, Space, Switch, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { JobSource } from '@jobtrack/shared';
import { useJobSources, useSaveJobSources } from '../api/hooks.js';

interface Props {
  kind: 'platforms' | 'apis';
}

interface FormValues {
  sources: JobSource[];
}

export function JobSourcesCard({ kind }: Props) {
  const { t } = useTranslation('settings');
  const [form] = Form.useForm<FormValues>();
  const { message } = AntApp.useApp();
  const { data, isLoading } = useJobSources();
  const save = useSaveJobSources();

  useEffect(() => {
    if (data) form.setFieldsValue({ sources: data[kind] });
  }, [data, form, kind]);

  async function handleFinish(values: FormValues): Promise<void> {
    const sources = (values.sources ?? []).map((source) => ({
      name: source.name.trim(),
      url: source.url?.trim() || null,
      notes: source.notes?.trim() || null,
      enabled: source.enabled ?? true,
    }));
    try {
      await save.mutateAsync({ [kind]: sources });
      message.success(t('sources.saveSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('sources.saveError'));
    }
  }

  return (
    <Card title={t(`sources.${kind}.title`)} loading={isLoading}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t(`sources.${kind}.description`)}
        </Typography.Paragraph>

        <Form form={form} layout="vertical" onFinish={handleFinish}>
          <Form.List name="sources">
            {(fields, { add, remove, move }) => (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {fields.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(`sources.${kind}.empty`)} />}
                {fields.map((field, index) => (
                  <SourceRow
                    key={field.key}
                    name={field.name}
                    index={index}
                    count={fields.length}
                    onMove={(by) => move(index, index + by)}
                    onRemove={() => remove(field.name)}
                  />
                ))}
                <Space wrap>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => add({ name: '', url: null, notes: null, enabled: true } satisfies JobSource)}
                  >
                    {t(`sources.${kind}.add`)}
                  </Button>
                  <Button type="primary" htmlType="submit" loading={save.isPending}>
                    {t('sources.saveButton')}
                  </Button>
                </Space>
              </Space>
            )}
          </Form.List>
        </Form>
      </Space>
    </Card>
  );
}

interface SourceRowProps {
  name: number;
  index: number;
  count: number;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

function SourceRow({ name, index, count, onMove, onRemove }: SourceRowProps) {
  const { t } = useTranslation('settings');
  const url = Form.useWatch(['sources', name, 'url']) as string | null | undefined;

  return (
    <Card size="small" styles={{ body: { paddingBottom: 0 } }}>
      <Row gutter={12} align="top">
        <Col flex="none" style={{ paddingTop: 30 }}>
          <Typography.Text type="secondary">{index + 1}.</Typography.Text>
        </Col>
        <Col xs={20} md={7}>
          <Form.Item name={[name, 'name']} label={t('sources.fields.name')} rules={[{ required: true, whitespace: true, message: t('sources.fields.nameRequired') }]}>
            <Input maxLength={120} />
          </Form.Item>
        </Col>
        <Col xs={24} md={10}>
          <Form.Item name={[name, 'url']} label={t('sources.fields.url')}>
            <Input
              maxLength={2000}
              placeholder="https://"
              suffix={
                url?.trim() ? (
                  <Tooltip title={t('sources.fields.open')}>
                    <a href={url.trim()} target="_blank" rel="noreferrer" aria-label={t('sources.fields.open')}>
                      <LinkOutlined />
                    </a>
                  </Tooltip>
                ) : (
                  <span />
                )
              }
            />
          </Form.Item>
        </Col>
        <Col flex="auto">
          <Form.Item name={[name, 'enabled']} label={t('sources.fields.enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Col>
        <Col flex="none" style={{ paddingTop: 30 }}>
          <Space size={2}>
            <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={index === 0} aria-label={t('sources.moveUp')} onClick={() => onMove(-1)} />
            <Button
              type="text"
              size="small"
              icon={<ArrowDownOutlined />}
              disabled={index === count - 1}
              aria-label={t('sources.moveDown')}
              onClick={() => onMove(1)}
            />
            <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={t('sources.remove')} onClick={onRemove} />
          </Space>
        </Col>
      </Row>
      <Form.Item name={[name, 'notes']} label={t('sources.fields.notes')}>
        <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} placeholder={t('sources.fields.notesPlaceholder')} />
      </Form.Item>
    </Card>
  );
}
