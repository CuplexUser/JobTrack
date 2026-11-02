/**
 * Settings > Browser > Behavior: choices about what the UI does after an action. Kept per
 * browser, see `useBrowserSetting` in `preferences.ts`.
 */

import { Card, Flex, Switch, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useOpenAfterConvert } from '../preferences.js';

export function BehaviorCard() {
  const { t } = useTranslation('settings');
  const [openAfterConvert, setOpenAfterConvert] = useOpenAfterConvert();

  return (
    <Card title={t('behavior.title')}>
      <Flex gap={12} align="flex-start">
        <Switch id="open-after-convert" checked={openAfterConvert} onChange={setOpenAfterConvert} />
        <Flex vertical>
          <label htmlFor="open-after-convert">
            <Typography.Text strong>{t('behavior.openAfterConvert.label')}</Typography.Text>
          </label>
          <Typography.Text type="secondary">{t('behavior.openAfterConvert.description')}</Typography.Text>
        </Flex>
      </Flex>
    </Card>
  );
}
