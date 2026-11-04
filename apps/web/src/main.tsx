import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'antd/dist/reset.css';
import './index.css';
import './i18n.js';
import { App } from './App.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A single-user local app: data only changes when this browser changes it, so
      // aggressive refetching buys nothing.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// A data router rather than `<BrowserRouter>` so a page can ask before navigating away from
// unsaved edits (`useBlocker`). The pages themselves are still declared in `App`.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
