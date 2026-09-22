/**
 * Settings > the app's display language. Kept in this browser only, the same as everything
 * else `RememberCard` manages, not in the database — so another browser or computer keeps
 * its own. See `locales/index.ts` for the list of languages and how to add one.
 */

import { Card, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_STORAGE_KEY } from '../i18n.js';
import { SUPPORTED_LANGUAGES } from '../locales/index.js';

export function LanguageCard() {
  const { t, i18n } = useTranslation('settings');

  function change(code: string): void {
    void i18n.changeLanguage(code);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
    } catch {
      // Persisting the preference is a convenience, never a requirement.
    }
  }

  return (
    <Card title={t('language.title')}>
      <Select
        style={{ width: 220 }}
        value={i18n.language}
        options={SUPPORTED_LANGUAGES.map((language) => ({ value: language.code, label: language.label }))}
        onChange={change}
      />
    </Card>
  );
}
