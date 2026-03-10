import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { HomeRedirectPage } from "./pages/HomeRedirectPage";
import { PosPage } from "./pages/PosPage";
import { WorkshopPage } from "./pages/WorkshopPage";
import { WorkshopJobPage } from "./pages/WorkshopJobPage";
import { CustomersPage } from "./pages/CustomersPage";
import { CustomerProfilePage } from "./pages/CustomerProfilePage";
import { CustomerTimelinePage } from "./pages/CustomerTimelinePage";
import { InventoryPage } from "./pages/InventoryPage";
import { InventoryItemPage } from "./pages/InventoryItemPage";
import { InventoryLocationsPage } from "./pages/InventoryLocationsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { PurchasingPage } from "./pages/PurchasingPage";
import { PurchaseOrderPage } from "./pages/PurchaseOrderPage";
import { SupplierReceivingPage } from "./pages/SupplierReceivingPage";
import { ManagementDashboardPage } from "./pages/ManagementDashboardPage";
import { DashboardSettingsPage } from "./pages/DashboardSettingsPage";
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
import { ServiceRemindersPage } from "./pages/ServiceRemindersPage";
import { SupplierCataloguePage } from "./pages/SupplierCataloguePage";
import { WorkshopBookingsPage } from "./pages/WorkshopBookingsPage";
import { WorkshopCalendarPage } from "./pages/WorkshopCalendarPage";
import { CustomerCommunicationQueuePage } from "./pages/CustomerCommunicationQueuePage";
import { WorkshopCheckInPage } from "./pages/WorkshopCheckInPage";
import { WorkshopCollectionPage } from "./pages/WorkshopCollectionPage";
import { WarrantyTrackingPage } from "./pages/WarrantyTrackingPage";
import { WorkshopPrintCentrePage } from "./pages/WorkshopPrintCentrePage";
import { InternalTasksPage } from "./pages/InternalTasksPage";
import { StockExceptionsPage } from "./pages/StockExceptionsPage";
import { TransferQueuePage } from "./pages/TransferQueuePage";
import { WorkshopAgeingPage } from "./pages/WorkshopAgeingPage";
import { ProductDataQueuePage } from "./pages/ProductDataQueuePage";
import { AdminReviewPage } from "./pages/AdminReviewPage";
import { PricingReviewPage } from "./pages/PricingReviewPage";
import { SupplierReturnsPage } from "./pages/SupplierReturnsPage";
import { OpsHealthPage } from "./pages/OpsHealthPage";
import { DailyTradeClosePage } from "./pages/DailyTradeClosePage";
import { LiabilitiesReviewPage } from "./pages/LiabilitiesReviewPage";
import { StaffPerformancePage } from "./pages/StaffPerformancePage";
import { DataIntegrityPage } from "./pages/DataIntegrityPage";
import { BackupToolkitPage } from "./pages/BackupToolkitPage";
import { SystemSettingsPage } from "./pages/SystemSettingsPage";

const AuthedApp = () => (
  <ProtectedRoute>
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomeRedirectPage />} />
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
          path="/management/dashboard-settings"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <DashboardSettingsPage />
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
          path="/management/trade-close"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <DailyTradeClosePage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/liabilities"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <LiabilitiesReviewPage />
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
          path="/management/reminders"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <ServiceRemindersPage />
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
          path="/management/catalogue"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <SupplierCataloguePage />
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
          path="/management/product-data"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <ProductDataQueuePage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/pricing"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <PricingReviewPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/supplier-returns"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <SupplierReturnsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/health"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <OpsHealthPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/integrity"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <DataIntegrityPage />
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
        <Route
          path="/management/admin-review"
          element={(
            <ProtectedRoute minimumRole="ADMIN">
              <AdminReviewPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/backups"
          element={(
            <ProtectedRoute minimumRole="ADMIN">
              <BackupToolkitPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/settings"
          element={(
            <ProtectedRoute minimumRole="ADMIN">
              <SystemSettingsPage />
            </ProtectedRoute>
          )}
        />
        <Route path="/pos" element={<PosPage />} />
        <Route path="/workshop" element={<WorkshopPage />} />
        <Route path="/workshop/check-in" element={<WorkshopCheckInPage />} />
        <Route path="/workshop/bookings" element={<WorkshopBookingsPage />} />
        <Route path="/workshop/collection" element={<WorkshopCollectionPage />} />
        <Route path="/workshop/print" element={<WorkshopPrintCentrePage />} />
        <Route path="/workshop/:id" element={<WorkshopJobPage />} />
        <Route
          path="/management/calendar"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <WorkshopCalendarPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/communications"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <CustomerCommunicationQueuePage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/warranty"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <WarrantyTrackingPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/stock-exceptions"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <StockExceptionsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/transfers"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <TransferQueuePage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/workshop-ageing"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <WorkshopAgeingPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/management/staff-performance"
          element={(
            <ProtectedRoute minimumRole="MANAGER">
              <StaffPerformancePage />
            </ProtectedRoute>
          )}
        />
        <Route path="/tasks" element={<InternalTasksPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerProfilePage />} />
        <Route path="/customers/:id/timeline" element={<CustomerTimelinePage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/locations" element={<InventoryLocationsPage />} />
        <Route path="/inventory/:variantId" element={<InventoryItemPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/purchasing" element={<PurchasingPage />} />
        <Route path="/purchasing/receiving" element={<SupplierReceivingPage />} />
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
