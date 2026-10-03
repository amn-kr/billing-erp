import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../features/shell/AppShell';
import { HomePage } from '../features/home/HomePage';
import { PartiesPage } from '../features/parties/PartiesPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'parties', element: <PartiesPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
