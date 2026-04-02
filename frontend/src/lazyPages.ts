import { lazy, type ComponentType } from "react";

const lazyPage = (
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
) =>
  lazy(async () => {
    const mod = await loader();
    return {
      default: mod[exportName] as ComponentType<any>,
    };
  });

export const LoginPage = lazyPage(() => import("./pages/LoginPage"), "LoginPage");
export const HomeRedirectPage = lazyPage(
  () => import("./pages/HomeRedirectPage"),
  "HomeRedirectPage",
);
export const PosPage = lazyPage(() => import("./pages/PosPage"), "PosPage");
export const WorkshopPage = lazyPage(() => import("./pages/WorkshopPage"), "WorkshopPage");
export const WorkshopTechnicianPage = lazyPage(
  () => import("./pages/WorkshopTechnicianPage"),
  "WorkshopTechnicianPage",
);
export const WorkshopJobPage = lazyPage(
  () => import("./pages/WorkshopJobPage"),
  "WorkshopJobPage",
);
export const CustomersPage = lazyPage(
  () => import("./pages/CustomersPage"),
  "CustomersPage",
);
export const CustomerProfilePage = lazyPage(
  () => import("./pages/CustomerProfilePage"),
  "CustomerProfilePage",
);
export const BikeHistoryPage = lazyPage(
  () => import("./pages/BikeHistoryPage"),
  "BikeHistoryPage",
);
export const CustomerTimelinePage = lazyPage(
  () => import("./pages/CustomerTimelinePage"),
  "CustomerTimelinePage",
);
export const InventoryPage = lazyPage(
  () => import("./pages/InventoryPage"),
  "InventoryPage",
);
export const InventoryItemPage = lazyPage(
  () => import("./pages/InventoryItemPage"),
  "InventoryItemPage",
);
export const ProductLabelPrintPage = lazyPage(
  () => import("./pages/ProductLabelPrintPage"),
  "ProductLabelPrintPage",
);
export const SalesReceiptPrintPage = lazyPage(
  () => import("./pages/SalesReceiptPrintPage"),
  "SalesReceiptPrintPage",
);
export const InventoryLocationsPage = lazyPage(
  () => import("./pages/InventoryLocationsPage"),
  "InventoryLocationsPage",
);
export const InventoryStocktakesPage = lazyPage(
  () => import("./pages/InventoryStocktakesPage"),
  "InventoryStocktakesPage",
);
export const DashboardPage = lazyPage(
  () => import("./pages/DashboardPage"),
  "DashboardPage",
);
export const BusinessIntelligencePage = lazyPage(
  () => import("./pages/BusinessIntelligencePage"),
  "BusinessIntelligencePage",
);
export const SuppliersPage = lazyPage(
  () => import("./pages/SuppliersPage"),
  "SuppliersPage",
);
export const PurchasingPage = lazyPage(
  () => import("./pages/PurchasingPage"),
  "PurchasingPage",
);
export const PurchaseOrderPage = lazyPage(
  () => import("./pages/PurchaseOrderPage"),
  "PurchaseOrderPage",
);
export const SupplierReceivingPage = lazyPage(
  () => import("./pages/SupplierReceivingPage"),
  "SupplierReceivingPage",
);
export const ManagementDashboardPage = lazyPage(
  () => import("./pages/ManagementDashboardPage"),
  "ManagementDashboardPage",
);
export const DashboardSettingsPage = lazyPage(
  () => import("./pages/DashboardSettingsPage"),
  "DashboardSettingsPage",
);
export const SalesAnalyticsPage = lazyPage(
  () => import("./pages/SalesAnalyticsPage"),
  "SalesAnalyticsPage",
);
export const WorkshopPerformancePage = lazyPage(
  () => import("./pages/WorkshopPerformancePage"),
  "WorkshopPerformancePage",
);
export const ProductSalesAnalyticsPage = lazyPage(
  () => import("./pages/ProductSalesAnalyticsPage"),
  "ProductSalesAnalyticsPage",
);
export const InventoryVelocityPage = lazyPage(
  () => import("./pages/InventoryVelocityPage"),
  "InventoryVelocityPage",
);
export const SupplierPerformancePage = lazyPage(
  () => import("./pages/SupplierPerformancePage"),
  "SupplierPerformancePage",
);
export const ReorderSuggestionsPage = lazyPage(
  () => import("./pages/ReorderSuggestionsPage"),
  "ReorderSuggestionsPage",
);
export const WorkshopCapacityPage = lazyPage(
  () => import("./pages/WorkshopCapacityPage"),
  "WorkshopCapacityPage",
);
export const StaffManagementPage = lazyPage(
  () => import("./pages/StaffManagementPage"),
  "StaffManagementPage",
);
export const ActivityPage = lazyPage(
  () => import("./pages/ActivityPage"),
  "ActivityPage",
);
export const CustomerInsightsPage = lazyPage(
  () => import("./pages/CustomerInsightsPage"),
  "CustomerInsightsPage",
);
export const PurchaseOrderActionPage = lazyPage(
  () => import("./pages/PurchaseOrderActionPage"),
  "PurchaseOrderActionPage",
);
export const RefundOversightPage = lazyPage(
  () => import("./pages/RefundOversightPage"),
  "RefundOversightPage",
);
export const CashOversightPage = lazyPage(
  () => import("./pages/CashOversightPage"),
  "CashOversightPage",
);
export const OperationsSummaryPage = lazyPage(
  () => import("./pages/OperationsSummaryPage"),
  "OperationsSummaryPage",
);
export const AlertsCentrePage = lazyPage(
  () => import("./pages/AlertsCentrePage"),
  "AlertsCentrePage",
);
export const ActionCentrePage = lazyPage(
  () => import("./pages/ActionCentrePage"),
  "ActionCentrePage",
);
export const OperationsExceptionsPage = lazyPage(
  () => import("./pages/OperationsExceptionsPage"),
  "OperationsExceptionsPage",
);
export const StockInvestigationsPage = lazyPage(
  () => import("./pages/StockInvestigationsPage"),
  "StockInvestigationsPage",
);
export const SavedViewsPage = lazyPage(
  () => import("./pages/SavedViewsPage"),
  "SavedViewsPage",
);
export const ExportHubPage = lazyPage(
  () => import("./pages/ExportHubPage"),
  "ExportHubPage",
);
export const ServiceRemindersPage = lazyPage(
  () => import("./pages/ServiceRemindersPage"),
  "ServiceRemindersPage",
);
export const SupplierCataloguePage = lazyPage(
  () => import("./pages/SupplierCataloguePage"),
  "SupplierCataloguePage",
);
export const WorkshopBookingsPage = lazyPage(
  () => import("./pages/WorkshopBookingsPage"),
  "WorkshopBookingsPage",
);
export const WorkshopCalendarPage = lazyPage(
  () => import("./pages/WorkshopCalendarPage"),
  "WorkshopCalendarPage",
);
export const WorkshopServiceTemplatesPage = lazyPage(
  () => import("./pages/WorkshopServiceTemplatesPage"),
  "WorkshopServiceTemplatesPage",
);
export const CustomerCommunicationQueuePage = lazyPage(
  () => import("./pages/CustomerCommunicationQueuePage"),
  "CustomerCommunicationQueuePage",
);
export const WorkshopCheckInPage = lazyPage(
  () => import("./pages/WorkshopCheckInPage"),
  "WorkshopCheckInPage",
);
export const WorkshopCollectionPage = lazyPage(
  () => import("./pages/WorkshopCollectionPage"),
  "WorkshopCollectionPage",
);
export const WarrantyTrackingPage = lazyPage(
  () => import("./pages/WarrantyTrackingPage"),
  "WarrantyTrackingPage",
);
export const WorkshopPrintCentrePage = lazyPage(
  () => import("./pages/WorkshopPrintCentrePage"),
  "WorkshopPrintCentrePage",
);
export const InternalTasksPage = lazyPage(
  () => import("./pages/InternalTasksPage"),
  "InternalTasksPage",
);
export const StockExceptionsPage = lazyPage(
  () => import("./pages/StockExceptionsPage"),
  "StockExceptionsPage",
);
export const TransferQueuePage = lazyPage(
  () => import("./pages/TransferQueuePage"),
  "TransferQueuePage",
);
export const BikeHirePage = lazyPage(
  () => import("./pages/BikeHirePage"),
  "BikeHirePage",
);
export const WorkshopAgeingPage = lazyPage(
  () => import("./pages/WorkshopAgeingPage"),
  "WorkshopAgeingPage",
);
export const ProductDataQueuePage = lazyPage(
  () => import("./pages/ProductDataQueuePage"),
  "ProductDataQueuePage",
);
export const AdminReviewPage = lazyPage(
  () => import("./pages/AdminReviewPage"),
  "AdminReviewPage",
);
export const PricingExceptionsPage = lazyPage(
  () => import("./pages/PricingExceptionsPage"),
  "PricingExceptionsPage",
);
export const SupplierReturnsPage = lazyPage(
  () => import("./pages/SupplierReturnsPage"),
  "SupplierReturnsPage",
);
export const OpsHealthPage = lazyPage(
  () => import("./pages/OpsHealthPage"),
  "OpsHealthPage",
);
export const DailyTradeClosePage = lazyPage(
  () => import("./pages/DailyTradeClosePage"),
  "DailyTradeClosePage",
);
export const LiabilitiesReviewPage = lazyPage(
  () => import("./pages/LiabilitiesReviewPage"),
  "LiabilitiesReviewPage",
);
export const StaffPerformancePage = lazyPage(
  () => import("./pages/StaffPerformancePage"),
  "StaffPerformancePage",
);
export const FinancialReportsPage = lazyPage(
  () => import("./pages/FinancialReportsPage"),
  "FinancialReportsPage",
);
export const DataIntegrityPage = lazyPage(
  () => import("./pages/DataIntegrityPage"),
  "DataIntegrityPage",
);
export const BackupToolkitPage = lazyPage(
  () => import("./pages/BackupToolkitPage"),
  "BackupToolkitPage",
);
export const SystemSettingsPage = lazyPage(
  () => import("./pages/SystemSettingsPage"),
  "SystemSettingsPage",
);
export const StaffRotaPage = lazyPage(
  () => import("./pages/StaffRotaPage"),
  "StaffRotaPage",
);
export const StaffRotaToolsPage = lazyPage(
  () => import("./pages/StaffRotaToolsPage"),
  "StaffRotaToolsPage",
);
export const OnboardingPage = lazyPage(
  () => import("./pages/OnboardingPage"),
  "OnboardingPage",
);
export const DocumentationHubPage = lazyPage(
  () => import("./pages/DocumentationHubPage"),
  "DocumentationHubPage",
);
export const PinSettingsPage = lazyPage(
  () => import("./pages/PinSettingsPage"),
  "PinSettingsPage",
);
export const CashReceiptUploadPage = lazyPage(
  () => import("./pages/CashReceiptUploadPage"),
  "CashReceiptUploadPage",
);
export const CustomerSitePage = lazyPage(
  () => import("./pages/CustomerSitePage"),
  "CustomerSitePage",
);
export const CustomerCapturePage = lazyPage(
  () => import("./pages/CustomerCapturePage"),
  "CustomerCapturePage",
);
export const CustomerAccountLoginPage = lazyPage(
  () => import("./pages/CustomerAccountLoginPage"),
  "CustomerAccountLoginPage",
);
export const CustomerAccountAccessPage = lazyPage(
  () => import("./pages/CustomerAccountAccessPage"),
  "CustomerAccountAccessPage",
);
export const CustomerAccountDashboardPage = lazyPage(
  () => import("./pages/CustomerAccountDashboardPage"),
  "CustomerAccountDashboardPage",
);
export const WorkshopQuotePage = lazyPage(
  () => import("./pages/WorkshopQuotePage"),
  "WorkshopQuotePage",
);
export const PublicWorkshopBookingPage = lazyPage(
  () => import("./pages/PublicWorkshopBookingPage"),
  "PublicWorkshopBookingPage",
);
export const PublicWorkshopBookingManagePage = lazyPage(
  () => import("./pages/PublicWorkshopBookingManagePage"),
  "PublicWorkshopBookingManagePage",
);
export const NavigationPlaceholderPage = lazyPage(
  () => import("./pages/NavigationPlaceholderPage"),
  "NavigationPlaceholderPage",
);
