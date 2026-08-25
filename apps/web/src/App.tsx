/**
 * Application shell: theme, navigation and routing.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { App as AntApp, Button, ConfigProvider, Dropdown, Layout, Menu, Typography, type MenuProps } from 'antd';
import {
  BgColorsOutlined,
  BulbOutlined,
  CheckOutlined,
  DashboardOutlined,
  FileTextOutlined,
  ProfileOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { DashboardPage } from './pages/DashboardPage.js';
import { ApplicationsPage } from './pages/ApplicationsPage.js';
import { ApplicationDetailPage } from './pages/ApplicationDetailPage.js';
import { CompaniesPage } from './pages/CompaniesPage.js';
import { CompanyDetailPage } from './pages/CompanyDetailPage.js';
import { NotesPage } from './pages/NotesPage.js';
import { OpeningsPage } from './pages/OpeningsPage.js';
import { buildAntdTheme, palette } from './theme.js';

const THEME_KEY = 'jobtrack.theme';

const NAV_ITEMS = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">Dashboard</Link> },
  { key: '/applications', icon: <ProfileOutlined />, label: <Link to="/applications">Applications</Link> },
  { key: '/openings', icon: <BulbOutlined />, label: <Link to="/openings">Openings</Link> },
  { key: '/companies', icon: <ShopOutlined />, label: <Link to="/companies">Companies</Link> },
  { key: '/notes', icon: <FileTextOutlined />, label: <Link to="/notes">Notes</Link> },
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

  // Grouped like a settings panel rather than a bare toggle, so a third mode (e.g. an
  // "auto" entry that follows the OS) has somewhere to go later without redesigning this.
  const themeMenuItems: MenuProps['items'] = useMemo(() => {
    const checkmark = (mode: 'light' | 'dark') => (
      <span style={{ display: 'inline-flex', width: 14, justifyContent: 'center' }}>
        {(mode === 'dark') === dark ? <CheckOutlined /> : null}
      </span>
    );
    return [
      { type: 'group', label: 'Light', children: [{ key: 'light', label: 'Light', icon: checkmark('light') }] },
      { type: 'group', label: 'Dark', children: [{ key: 'dark', label: 'Dark', icon: checkmark('dark') }] },
    ];
  }, [dark]);

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
                items: themeMenuItems,
                selectable: true,
                selectedKeys: [dark ? 'dark' : 'light'],
                onClick: ({ key }) => setDark(key === 'dark'),
              }}
            >
              <Button icon={<BgColorsOutlined />} aria-label="Theme settings">
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
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Layout.Content>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}
