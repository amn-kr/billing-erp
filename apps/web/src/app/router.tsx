import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../features/shell/AppShell';
import { HomePage } from '../features/home/HomePage';
import { PartiesPage } from '../features/parties/PartiesPage';
import { ImportChoicePage } from '../features/parties/ImportChoicePage';
import { ImportExcelPage } from '../features/parties/ImportExcelPage';
import { ItemsPage } from '../features/items/ItemsPage';
import { BrandsPage } from '../features/items/BrandsPage';
import { ImportPage } from '../features/items/ImportPage';
import { BulkUpdatePage } from '../features/items/BulkUpdatePage';
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
import { CommissionPage } from '../features/commission/CommissionPage';
import { ChequesPage, ReconciliationPage } from '../features/banking/ChequesPages';
import { ExpensesPage } from '../features/expenses/ExpensesPage';
import { BankAccountsPage, CashPage } from '../features/banking/BankingPages';
import { PurchaseEditor } from '../features/purchases/PurchaseEditor';
import { DebitNotesPage, PaymentsMadePage, PurchaseBillsPage, PurchaseOrdersPage } from '../features/purchases/PurchaseLists';
import { ReportsPage } from '../features/reports/ReportsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'parties', element: <PartiesPage /> },
      { path: 'parties/import', element: <ImportChoicePage /> },
      { path: 'parties/import/excel', element: <ImportExcelPage /> },
      { path: 'items', element: <ItemsPage /> },
      { path: 'items/brands', element: <BrandsPage /> },
      { path: 'items/import', element: <ImportPage /> },
      { path: 'items/bulk-update', element: <BulkUpdatePage /> },
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
      { path: 'bank-accounts', element: <BankAccountsPage /> },
      { path: 'cash-in-hand', element: <CashPage /> },
      { path: 'expenses', element: <ExpensesPage /> },
      { path: 'cheques', element: <ChequesPage /> },
      { path: 'reconciliation', element: <ReconciliationPage /> },
      { path: 'commission', element: <CommissionPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
