import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../features/shell/AppShell';
import { HomePage } from '../features/home/HomePage';
import { PartiesPage } from '../features/parties/PartiesPage';
import { ItemsPage } from '../features/items/ItemsPage';
import { AdjustmentsPage } from '../features/stock/AdjustmentsPage';
import { PricesPage } from '../features/prices/PricesPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { GodownsPage } from '../features/stock/GodownsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'parties', element: <PartiesPage /> },
      { path: 'items', element: <ItemsPage /> },
      { path: 'prices', element: <PricesPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'stock-adjustments', element: <AdjustmentsPage /> },
      { path: 'godowns', element: <GodownsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
