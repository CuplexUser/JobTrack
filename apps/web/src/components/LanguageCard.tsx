/**
 * Settings > the app's display language. Persisted two ways: this browser's own
 * `localStorage` (so this browser is instant and works offline), and, via the API, the
 * `language` app setting shared with the Windows tray app (see `settings.service.ts`'s
 * `getLanguage`) — so a choice made here or there shows up in both. "System" clears the
 * explicit choice in both places and falls back to this browser's own language detection.
 * See `locales/index.ts` for the list of languages and how to add one.
 */

import { useState } from 'react';
import { Card, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_STORAGE_KEY } from '../i18n.js';
import { SUPPORTED_LANGUAGES } from '../locales/index.js';
import { useSaveLanguage } from '../api/hooks.js';

const SYSTEM = 'system';

function explicitChoice(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function LanguageCard() {
  const { t, i18n } = useTranslation('settings');
  const saveLanguage = useSaveLanguage();
  const [selected, setSelected] = useState<string>(() => explicitChoice() ?? SYSTEM);

  function change(value: string): void {
    setSelected(value);
    if (value === SYSTEM) {
      try {
        localStorage.removeItem(LANGUAGE_STORAGE_KEY);
      } catch {
        // Falls through to the detector's own default regardless.
      }
      const detected = i18n.services.languageDetector?.detect();
      const code = (Array.isArray(detected) ? detected[0] : detected) ?? 'en';
      void i18n.changeLanguage(code);
      saveLanguage.mutate({ code: null });
      return;
    }

    void i18n.changeLanguage(value);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
    } catch {
      // Persisting the preference is a convenience, never a requirement.
    }
    saveLanguage.mutate({ code: value });
  }

  return (
    <Card title={t('language.title')}>
      <Select
        style={{ width: 220 }}
        value={selected}
        options={[
          { value: SYSTEM, label: t('language.system') },
          ...SUPPORTED_LANGUAGES.map((language) => ({ value: language.code, label: language.label })),
        ]}
        onChange={change}
      />
    </Card>
  );
}
