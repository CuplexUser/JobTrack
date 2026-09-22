/**
 * Every supported language in one place. Adding a language after English and Swedish is a
 * drop-in: create `locales/<code>/*.json` mirroring `en/`, add one entry here with its
 * display label and (if antd/dayjs ship one) a locale pack loader, and it appears in
 * `LanguageCard` with no other code changes.
 */

export interface SupportedLanguage {
  code: string;
  /** Shown in the language switcher, in that language itself, not translated. */
  label: string;
  /** Lazily loaded so unselected languages' antd locale packs never ship in the initial bundle. */
  antdLocale: () => Promise<{ default: unknown }>;
  dayjsLocale: () => Promise<unknown>;
}

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  {
    code: 'en',
    label: 'English',
    antdLocale: () => import('antd/locale/en_US.js'),
    dayjsLocale: () => import('dayjs/locale/en.js'),
  },
  {
    code: 'sv',
    label: 'Svenska',
    antdLocale: () => import('antd/locale/sv_SE.js'),
    dayjsLocale: () => import('dayjs/locale/sv.js'),
  },
];
