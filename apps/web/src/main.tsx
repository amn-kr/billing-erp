import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Boot } from './app/Boot';
import { router } from './app/router';
import { blockBrowserMenu } from './lib/browserMenu';

blockBrowserMenu();

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Boot>
        <RouterProvider router={router} />
      </Boot>
    </QueryClientProvider>
  </StrictMode>,
);
