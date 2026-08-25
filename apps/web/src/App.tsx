/**
 * Application shell: theme, navigation and routing.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { App as AntApp, ConfigProvider, Layout, Menu, Switch, Typography, theme } from 'antd';
import {
  BulbOutlined,
  DashboardOutlined,
  FileTextOutlined,
  MoonOutlined,
  ProfileOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { DashboardPage } from './pages/DashboardPage.js';
import { ApplicationsPage } from './pages/ApplicationsPage.js';
import { ApplicationDetailPage } from './pages/ApplicationDetailPage.js';
import { CompaniesPage } from './pages/CompaniesPage.js';
import { CompanyDetailPage } from './pages/CompanyDetailPage.js';
import { NotesPage } from './pages/NotesPage.js';

const THEME_KEY = 'jobtrack.theme';

const NAV_ITEMS = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">Dashboard</Link> },
  { key: '/applications', icon: <ProfileOutlined />, label: <Link to="/applications">Applications</Link> },
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
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#4f46e5',
          borderRadius: 8,
          fontSize: 14,
        },
        components: {
          Layout: dark
            ? { siderBg: '#141414', headerBg: '#141414' }
            : { siderBg: '#ffffff', headerBg: '#ffffff' },
        },
      }}
    >
      <AntApp>
        <Layout style={{ minHeight: '100vh' }}>
          <Layout.Header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              paddingInline: 24,
              borderBottom: `1px solid ${dark ? '#303030' : '#f0f0f0'}`,
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <Typography.Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>
              Job<span style={{ color: '#4f46e5' }}>Track</span>
            </Typography.Title>

            <Menu
              mode="horizontal"
              selectedKeys={selectedKey}
              items={NAV_ITEMS}
              style={{ flex: 1, minWidth: 0, borderBottom: 'none' }}
            />

            <Switch
              checked={dark}
              onChange={setDark}
              checkedChildren={<MoonOutlined />}
              unCheckedChildren={<BulbOutlined />}
              aria-label="Toggle dark mode"
            />
          </Layout.Header>

          <Layout.Content style={{ padding: 24 }}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/applications/:id" element={<ApplicationDetailPage />} />
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
