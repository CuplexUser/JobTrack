/**
 * Settings > Remembered in this browser: how long the web UI keeps sort orders and filters,
 * and a way to forget them. The storage itself is in `preferences.ts`.
 */

import { useState } from 'react';
import { App as AntApp, Button, Card, Descriptions, Flex, Segmented, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_REMEMBER_MODES,
  countPreferences,
  forgetPreferences,
  loadRememberModes,
  setRememberMode,
  type PreferenceGroup,
  type RememberMode,
} from '../preferences.js';

const GROUPS: { group: PreferenceGroup; labelKey: string; coversKey: string }[] = [
  { group: 'view', labelKey: 'remember.groups.view.label', coversKey: 'remember.groups.view.covers' },
  { group: 'filters', labelKey: 'remember.groups.filters.label', coversKey: 'remember.groups.filters.covers' },
];

const MODE_KEYS: { key: string; value: RememberMode }[] = [
  { key: 'remember.modes.always', value: 'always' },
  { key: 'remember.modes.session', value: 'session' },
  { key: 'remember.modes.off', value: 'off' },
];

export function RememberCard() {
  const { t } = useTranslation('settings');
  const { message } = AntApp.useApp();
  const [modes, setModes] = useState(loadRememberModes);
  const [count, setCount] = useState(countPreferences);

  function change(group: PreferenceGroup, mode: RememberMode): void {
    setRememberMode(group, mode);
    setModes(loadRememberModes());
    setCount(countPreferences());
  }

  function forget(): void {
    forgetPreferences();
    setCount(countPreferences());
    message.success(t('remember.forgetSuccess'));
  }

  return (
    <Card
      title={t('remember.title')}
      extra={
        <Button size="small" disabled={count === 0} onClick={forget}>
          {t('remember.forgetButton')}
        </Button>
      }
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">{t('remember.description')}</Typography.Text>
        <Descriptions size="small" column={1} bordered>
          {GROUPS.map(({ group, labelKey, coversKey }) => (
            <Descriptions.Item
              key={group}
              label={
                <Flex vertical>
                  <span>{t(labelKey)}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                    {t(coversKey)}
                  </Typography.Text>
                </Flex>
              }
            >
              <Segmented<RememberMode>
                value={modes[group]}
                onChange={(mode) => change(group, mode)}
                options={MODE_KEYS.map((option) => ({
                  value: option.value,
                  label:
                    option.value === DEFAULT_REMEMBER_MODES[group]
                      ? t('remember.modeDefaultSuffix', { label: t(option.key) })
                      : t(option.key),
                }))}
              />
            </Descriptions.Item>
          ))}
        </Descriptions>
      </Flex>
    </Card>
  );
}
