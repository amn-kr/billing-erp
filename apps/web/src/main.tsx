import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Boot } from './app/Boot';
import { router } from './app/router';
import { blockBrowserMenu } from './lib/browserMenu';

const root = document.getElementById('root')!;

// the software owner's panel lives in its own folder and is loaded only at /owner
if (window.location.pathname === '/owner' || window.location.pathname.startsWith('/owner/')) {
  void import('./owner/main').then((m) => m.startOwner(root));
} else {
  startShop();
}

function startShop() {
  blockBrowserMenu();

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Boot>
          <RouterProvider router={router} />
        </Boot>
      </QueryClientProvider>
    </StrictMode>,
  );
}
