import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../features/shell/AppShell';
import { HomePage } from '../features/home/HomePage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
