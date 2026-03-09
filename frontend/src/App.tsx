import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { PosPage } from "./pages/PosPage";
import { WorkshopPage } from "./pages/WorkshopPage";
import { WorkshopJobPage } from "./pages/WorkshopJobPage";
import { CustomersPage } from "./pages/CustomersPage";
import { CustomerProfilePage } from "./pages/CustomerProfilePage";
import { InventoryPage } from "./pages/InventoryPage";
import { InventoryItemPage } from "./pages/InventoryItemPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { PurchasingPage } from "./pages/PurchasingPage";
import { PurchaseOrderPage } from "./pages/PurchaseOrderPage";
import { ManagementDashboardPage } from "./pages/ManagementDashboardPage";
import { SalesAnalyticsPage } from "./pages/SalesAnalyticsPage";
import { WorkshopPerformancePage } from "./pages/WorkshopPerformancePage";
import { ProductSalesAnalyticsPage } from "./pages/ProductSalesAnalyticsPage";
import { InventoryVelocityPage } from "./pages/InventoryVelocityPage";
import { SupplierPerformancePage } from "./pages/SupplierPerformancePage";
import { ReorderSuggestionsPage } from "./pages/ReorderSuggestionsPage";
import { WorkshopCapacityPage } from "./pages/WorkshopCapacityPage";
import { StaffManagementPage } from "./pages/StaffManagementPage";
import { ActivityPage } from "./pages/ActivityPage";
import { CustomerInsightsPage } from "./pages/CustomerInsightsPage";
import { PurchaseOrderActionPage } from "./pages/PurchaseOrderActionPage";
import { RefundOversightPage } from "./pages/RefundOversightPage";
import { CashOversightPage } from "./pages/CashOversightPage";
import { OperationsSummaryPage } from "./pages/OperationsSummaryPage";
import { AlertsCentrePage } from "./pages/AlertsCentrePage";
import { SavedViewsPage } from "./pages/SavedViewsPage";
import { ExportHubPage } from "./pages/ExportHubPage";

const AuthedApp = () => (
  <ProtectedRoute>
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/pos" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route
          path="/management"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <ManagementDashboardPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/sales"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <SalesAnalyticsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/workshop"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <WorkshopPerformancePage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/products"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <ProductSalesAnalyticsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/inventory"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <InventoryVelocityPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/suppliers"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <SupplierPerformancePage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/reordering"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <ReorderSuggestionsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/capacity"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <WorkshopCapacityPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/activity"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <ActivityPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/refunds"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <RefundOversightPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/cash"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <CashOversightPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/summary"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <OperationsSummaryPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/alerts"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <AlertsCentrePage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/views"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <SavedViewsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/exports"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <ExportHubPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/customers"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <CustomerInsightsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/purchasing"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <PurchaseOrderActionPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/staff"
          element={(
            <ProtectedRoute minimumRole="ADMIN">
              <StaffManagementPage />
            </ProtectedRoute>
          )}
        />
        <Route path="/pos" element={<PosPage />} />
        <Route path="/workshop" element={<WorkshopPage />} />
        <Route path="/workshop/:id" element={<WorkshopJobPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerProfilePage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/:variantId" element={<InventoryItemPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/purchasing" element={<PurchasingPage />} />
        <Route path="/purchasing/:id" element={<PurchaseOrderPage />} />
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    </Layout>
  </ProtectedRoute>
);

export const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<AuthedApp />} />
    </Routes>
  );
};
