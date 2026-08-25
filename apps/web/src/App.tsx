/**
 * Application shell: theme, navigation and routing.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { App as AntApp, Button, ConfigProvider, Dropdown, Layout, Menu, Typography, type MenuProps } from 'antd';
import {
  BulbOutlined,
  DashboardOutlined,
  FileTextOutlined,
  MoonOutlined,
  ProfileOutlined,
  SettingOutlined,
  ShopOutlined,
  SunOutlined,
} from '@ant-design/icons';
import { DashboardPage } from './pages/DashboardPage.js';
import { ApplicationsPage } from './pages/ApplicationsPage.js';
import { ApplicationDetailPage } from './pages/ApplicationDetailPage.js';
import { CompaniesPage } from './pages/CompaniesPage.js';
import { CompanyDetailPage } from './pages/CompanyDetailPage.js';
import { NotesPage } from './pages/NotesPage.js';
import { OpeningsPage } from './pages/OpeningsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { buildAntdTheme, palette } from './theme.js';

const THEME_KEY = 'jobtrack.theme';

const NAV_ITEMS = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">Dashboard</Link> },
  { key: '/applications', icon: <ProfileOutlined />, label: <Link to="/applications">Applications</Link> },
  { key: '/openings', icon: <BulbOutlined />, label: <Link to="/openings">Openings</Link> },
  { key: '/companies', icon: <ShopOutlined />, label: <Link to="/companies">Companies</Link> },
  { key: '/notes', icon: <FileTextOutlined />, label: <Link to="/notes">Notes</Link> },
  { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">Settings</Link> },
];

/**
 * Flat, not grouped — a group whose label duplicated its single child's label used to render
 * "Light" (a dim, non-interactive header) directly above "Light" (the actual, unstyled menu
 * item), which is what made the unselected option look broken next to the selected one's
 * highlighted pill. Each option now carries its own icon, and `selectedKeys` on the Dropdown
 * below is the only thing that marks which one is active.
 */
const THEME_MENU_ITEMS: MenuProps['items'] = [
  { key: 'light', icon: <SunOutlined />, label: 'Light' },
  { key: 'dark', icon: <MoonOutlined />, label: 'Dark' },
];

export function App() {
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

  const location = useLocation();
  // Highlight the section, not the exact URL, so a detail page keeps its parent lit.
  const selectedKey = useMemo(() => {
    const match = NAV_ITEMS.find((item) => location.pathname.startsWith(item.key));
    return match ? [match.key] : ['/dashboard'];
  }, [location.pathname]);

  return (
    <ConfigProvider theme={buildAntdTheme(dark ? 'dark' : 'light')}>
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
                items: THEME_MENU_ITEMS,
                selectable: true,
                selectedKeys: [dark ? 'dark' : 'light'],
                onClick: ({ key }) => setDark(key === 'dark'),
              }}
            >
              <Button icon={dark ? <MoonOutlined /> : <SunOutlined />} aria-label="Theme settings">
                Theme
              </Button>
            </Dropdown>
          </Layout.Header>

          <Layout.Content style={{ padding: 24 }}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/applications/:id" element={<ApplicationDetailPage />} />
              <Route path="/openings" element={<OpeningsPage />} />
              <Route path="/companies" element={<CompaniesPage />} />
              <Route path="/companies/:id" element={<CompanyDetailPage />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Layout.Content>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}
