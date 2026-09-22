/**
 * i18next setup. Imported once, as a side effect, before the app renders (`main.tsx`) and
 * before tests run (`test-setup.ts`), so every `useTranslation()` call resolves against a
 * ready instance without needing an `I18nextProvider` wrapper anywhere.
 *
 * Both languages' namespaces are bundled eagerly: with two languages and a few hundred
 * strings total, a runtime fetch would only add a loading state to design around for no
 * real payload savings. `SUPPORTED_LANGUAGES` (locales/index.ts) is the drop-in point for a
 * third language — add its namespace files there and to `resources` below.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enDashboard from './locales/en/dashboard.json';
import enSettings from './locales/en/settings.json';
import enFit from './locales/en/fit.json';
import enApplications from './locales/en/applications.json';
import enCompanies from './locales/en/companies.json';
import enContacts from './locales/en/contacts.json';
import enOpenings from './locales/en/openings.json';
import enNotes from './locales/en/notes.json';
import enImport from './locales/en/import.json';
import enStatistics from './locales/en/statistics.json';
import enCharts from './locales/en/charts.json';
import svCommon from './locales/sv/common.json';
import svDashboard from './locales/sv/dashboard.json';
import svSettings from './locales/sv/settings.json';
import svFit from './locales/sv/fit.json';
import svApplications from './locales/sv/applications.json';
import svCompanies from './locales/sv/companies.json';
import svContacts from './locales/sv/contacts.json';
import svOpenings from './locales/sv/openings.json';
import svNotes from './locales/sv/notes.json';
import svImport from './locales/sv/import.json';
import svStatistics from './locales/sv/statistics.json';
import svCharts from './locales/sv/charts.json';

export const LANGUAGE_STORAGE_KEY = 'jobtrack.language';

const NAMESPACES = [
  'common',
  'dashboard',
  'settings',
  'fit',
  'applications',
  'companies',
  'contacts',
  'openings',
  'notes',
  'import',
  'statistics',
  'charts',
] as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: NAMESPACES,
    resources: {
      en: {
        common: enCommon,
        dashboard: enDashboard,
        settings: enSettings,
        fit: enFit,
        applications: enApplications,
        companies: enCompanies,
        contacts: enContacts,
        openings: enOpenings,
        notes: enNotes,
        import: enImport,
        statistics: enStatistics,
        charts: enCharts,
      },
      sv: {
        common: svCommon,
        dashboard: svDashboard,
        settings: svSettings,
        fit: svFit,
        applications: svApplications,
        companies: svCompanies,
        contacts: svContacts,
        openings: svOpenings,
        notes: svNotes,
        import: svImport,
        statistics: svStatistics,
        charts: svCharts,
      },
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      // React already escapes everything it renders.
      escapeValue: false,
    },
  });

export default i18n;
