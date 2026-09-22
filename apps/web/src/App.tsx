/**
 * Application shell: theme, navigation and routing.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { App as AntApp, Button, ConfigProvider, Dropdown, Layout, Menu, Spin, Typography, type MenuProps } from 'antd';
import type { Locale } from 'antd/es/locale/index.js';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
  BarChartOutlined,
  BulbOutlined,
  DashboardOutlined,
  FileTextOutlined,
  MoonOutlined,
  ProfileOutlined,
  SettingOutlined,
  ShopOutlined,
  SunOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { RememberParams } from './components/RememberParams.js';
import { APPLICATIONS_PARAMS, CONTACTS_PARAMS, STATISTICS_PARAMS } from './preferences.js';
import { buildAntdTheme, palette } from './theme.js';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './locales/index.js';
import { LANGUAGE_STORAGE_KEY } from './i18n.js';
import { useLanguage } from './api/hooks.js';

/**
 * Each page is its own chunk, fetched only when its route is visited, rather than one
 * monolithic bundle everyone downloads to see the dashboard. Named exports (not default),
 * so each loader picks the one export out of the module dynamic `import()` resolves to.
 */
const DashboardPage = lazy(() => import('./pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage })));
const StatisticsPage = lazy(() => import('./pages/StatisticsPage.js').then((m) => ({ default: m.StatisticsPage })));
const ApplicationsPage = lazy(() => import('./pages/ApplicationsPage.js').then((m) => ({ default: m.ApplicationsPage })));
const ApplicationDetailPage = lazy(() =>
  import('./pages/ApplicationDetailPage.js').then((m) => ({ default: m.ApplicationDetailPage })),
);
const DuplicatesPage = lazy(() => import('./pages/DuplicatesPage.js').then((m) => ({ default: m.DuplicatesPage })));
const CompaniesPage = lazy(() => import('./pages/CompaniesPage.js').then((m) => ({ default: m.CompaniesPage })));
const CompanyDetailPage = lazy(() => import('./pages/CompanyDetailPage.js').then((m) => ({ default: m.CompanyDetailPage })));
const NotesPage = lazy(() => import('./pages/NotesPage.js').then((m) => ({ default: m.NotesPage })));
const OpeningsPage = lazy(() => import('./pages/OpeningsPage.js').then((m) => ({ default: m.OpeningsPage })));
const ContactsPage = lazy(() => import('./pages/ContactsPage.js').then((m) => ({ default: m.ContactsPage })));
const ContactDetailPage = lazy(() => import('./pages/ContactDetailPage.js').then((m) => ({ default: m.ContactDetailPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage })));

const THEME_KEY = 'jobtrack.theme';

function findLanguage(code: string): SupportedLanguage {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code) ?? SUPPORTED_LANGUAGES[0]!;
}

export function App() {
  const { t, i18n } = useTranslation();

  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored) return stored === 'dark';
    } catch {
      // Private mode or blocked storage — fall through to the OS preference.
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // Persisting the preference is a convenience, never a requirement.
    }
  }, [dark]);

  // A language chosen in the Windows tray app (including "follow the system") wins over this
  // browser's own detection, so the two agree. `code` is null until either app has ever set
  // one, in which case the existing localStorage/navigator-based default (i18n.ts) stands.
  const { data: sharedLanguage } = useLanguage();
  useEffect(() => {
    if (!sharedLanguage?.code || sharedLanguage.code === i18n.language) return;
    void i18n.changeLanguage(sharedLanguage.code);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, sharedLanguage.code);
    } catch {
      // Persisting the preference is a convenience, never a requirement.
    }
  }, [sharedLanguage, i18n]);

  // Keeps antd's own chrome (pagination, date pickers, empty states, …) and dayjs-driven
  // date formatting in step with the app-level language, not just JobTrack's own strings.
  // `undefined` until the first language pack resolves, which renders antd's own English
  // default for one tick — never wrong, since English is also this app's fallback language.
  const [antdLocale, setAntdLocale] = useState<Locale | undefined>(undefined);
  useEffect(() => {
    const language = findLanguage(i18n.language);
    let cancelled = false;
    Promise.all([language.antdLocale(), language.dayjsLocale()]).then(([antdModule]) => {
      if (cancelled) return;
      setAntdLocale(antdModule.default as Locale);
      dayjs.locale(language.code);
    });
    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

  const NAV_ITEMS = useMemo(
    () => [
      { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">{t('nav.dashboard')}</Link> },
      { key: '/statistics', icon: <BarChartOutlined />, label: <Link to="/statistics">{t('nav.statistics')}</Link> },
      { key: '/applications', icon: <ProfileOutlined />, label: <Link to="/applications">{t('nav.applications')}</Link> },
      { key: '/openings', icon: <BulbOutlined />, label: <Link to="/openings">{t('nav.openings')}</Link> },
      { key: '/companies', icon: <ShopOutlined />, label: <Link to="/companies">{t('nav.companies')}</Link> },
      { key: '/people', icon: <TeamOutlined />, label: <Link to="/people">{t('nav.people')}</Link> },
      { key: '/notes', icon: <FileTextOutlined />, label: <Link to="/notes">{t('nav.notes')}</Link> },
      { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">{t('nav.settings')}</Link> },
    ],
    [t],
  );

  /**
   * Flat, not grouped — a group whose label duplicated its single child's label used to render
   * "Light" (a dim, non-interactive header) directly above "Light" (the actual, unstyled menu
   * item), which is what made the unselected option look broken next to the selected one's
   * highlighted pill. Each option now carries its own icon, and `selectedKeys` on the Dropdown
   * below is the only thing that marks which one is active.
   */
  const themeMenuItems: MenuProps['items'] = useMemo(
    () => [
      { key: 'light', icon: <SunOutlined />, label: t('theme.light') },
      { key: 'dark', icon: <MoonOutlined />, label: t('theme.dark') },
    ],
    [t],
  );

  const location = useLocation();
  // Highlight the section, not the exact URL, so a detail page keeps its parent lit.
  const selectedKey = useMemo(() => {
    const match = NAV_ITEMS.find((item) => location.pathname.startsWith(item.key));
    return match ? [match.key] : ['/dashboard'];
  }, [location.pathname, NAV_ITEMS]);

  return (
    <ConfigProvider theme={buildAntdTheme(dark ? 'dark' : 'light')} locale={antdLocale}>
      <AntApp>
        <Layout style={{ minHeight: '100vh' }}>
          <Layout.Header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              paddingInline: 24,
              borderBottom: `1px solid ${palette.border}`,
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <Typography.Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>
              Job<span style={{ color: palette.accent }}>Track</span>
            </Typography.Title>

            <Menu
              mode="horizontal"
              selectedKeys={selectedKey}
              items={NAV_ITEMS}
              style={{ flex: 1, minWidth: 0, borderBottom: 'none' }}
            />

            <Dropdown
              trigger={['click']}
              menu={{
                items: themeMenuItems,
                selectable: true,
                selectedKeys: [dark ? 'dark' : 'light'],
                onClick: ({ key }) => setDark(key === 'dark'),
              }}
            >
              <Button icon={dark ? <MoonOutlined /> : <SunOutlined />} aria-label={t('theme.ariaLabel')}>
                {t('theme.button')}
              </Button>
            </Dropdown>
          </Layout.Header>

          <Layout.Content style={{ padding: 24 }}>
            <Suspense fallback={<Spin size="large" style={{ display: 'flex', justifyContent: 'center', marginTop: 80 }} />}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/statistics" element={<RememberParams spec={STATISTICS_PARAMS}><StatisticsPage /></RememberParams>} />
                <Route path="/applications" element={<RememberParams spec={APPLICATIONS_PARAMS}><ApplicationsPage /></RememberParams>} />
                {/* Before `/:id`, so the word is a page and not an application id. */}
                <Route path="/applications/duplicates" element={<DuplicatesPage />} />
                <Route path="/applications/:id" element={<ApplicationDetailPage />} />
                <Route path="/openings" element={<OpeningsPage />} />
                <Route path="/companies" element={<CompaniesPage />} />
                <Route path="/companies/:id" element={<CompanyDetailPage />} />
                <Route path="/people" element={<RememberParams spec={CONTACTS_PARAMS}><ContactsPage /></RememberParams>} />
                <Route path="/people/:id" element={<ContactDetailPage />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </Layout.Content>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}
