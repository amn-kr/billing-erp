import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../features/shell/AppShell';
import { HomePage } from '../features/home/HomePage';
import { PartiesPage } from '../features/parties/PartiesPage';
import { ItemsPage } from '../features/items/ItemsPage';
import { AdjustmentsPage } from '../features/stock/AdjustmentsPage';
import { PricesPage } from '../features/prices/PricesPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { GodownsPage } from '../features/stock/GodownsPage';
import { SalesPage } from '../features/sales/SalesPage';
import { PaymentsReceivedPage } from '../features/sales/PaymentsReceivedPage';
import { CreditNotesPage } from '../features/sales/CreditNotesPage';
import { ChallansPage } from '../features/sales/ChallansPage';
import { SaleEditor } from '../features/sales/editor/SaleEditor';
import { QuotationsPage } from '../features/quotations/QuotationsPage';
import { PurchaseEditor } from '../features/purchases/PurchaseEditor';
import { DebitNotesPage, PaymentsMadePage, PurchaseBillsPage, PurchaseOrdersPage } from '../features/purchases/PurchaseLists';

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
      { path: 'sales', element: <SalesPage /> },
      { path: 'sales/new', element: <SaleEditor /> },
      { path: 'quotations', element: <QuotationsPage /> },
      { path: 'payments-received', element: <PaymentsReceivedPage /> },
      { path: 'credit-notes', element: <CreditNotesPage /> },
      { path: 'delivery-challans', element: <ChallansPage /> },
      { path: 'purchase-bills', element: <PurchaseBillsPage /> },
      { path: 'purchase-orders', element: <PurchaseOrdersPage /> },
      { path: 'payments-made', element: <PaymentsMadePage /> },
      { path: 'debit-notes', element: <DebitNotesPage /> },
      { path: 'purchases/new', element: <PurchaseEditor /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
