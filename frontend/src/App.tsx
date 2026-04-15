import { Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import {
  ActionCentrePage,
  ActivityPage,
  AdminReviewPage,
  AlertsCentrePage,
  BackupToolkitPage,
  BikeTagPrintPage,
  BusinessIntelligencePage,
  BikeHistoryPage,
  BikeHirePage,
  CashOversightPage,
  CashReceiptUploadPage,
  CustomerCapturePage,
  CustomerAccountAccessPage,
  CustomerAccountDashboardPage,
  CustomerAccountLoginPage,
  CustomerCommunicationQueuePage,
  CustomerInsightsPage,
  CustomerProfilePage,
  CustomerSitePage,
  CustomersPage,
  CustomerTimelinePage,
  DailyTradeClosePage,
  DashboardPage,
  DashboardSettingsPage,
  DataIntegrityPage,
  DocumentationHubPage,
  ExportHubPage,
  FinancialReportsPage,
  HomeRedirectPage,
  InternalTasksPage,
  InventoryItemPage,
  InventoryLocationsPage,
  InventoryPage,
  InventoryStocktakesPage,
  InventoryVelocityPage,
  LiabilitiesReviewPage,
  LoginPage,
  ManagementDashboardPage,
  NavigationPlaceholderPage,
  OnboardingPage,
  OnlineStoreOrdersPage,
  OperationsExceptionsPage,
  OperationsSummaryPage,
  OpsHealthPage,
  PinSettingsPage,
  PosPage,
  PricingExceptionsPage,
  ProductDataQueuePage,
  ProductLabelPrintPage,
  ProductSalesAnalyticsPage,
  PublicWorkshopBookingManagePage,
  PublicWorkshopBookingPage,
  PurchaseOrderActionPage,
  PurchaseOrderPage,
  PurchasingPage,
  RefundOversightPage,
  ReorderSuggestionsPage,
  SalesAnalyticsPage,
  SalesHistoryPage,
  SalesInvoicePrintPage,
  SavedViewsPage,
  SalesReceiptPrintPage,
  ServiceRemindersPage,
  StaffManagementPage,
  StaffPerformancePage,
  StaffRotaPage,
  StaffRotaToolsPage,
  StockExceptionsPage,
  StockInvestigationsPage,
  SupplierCataloguePage,
  SupplierPerformancePage,
  SupplierReceivingPage,
  SupplierReturnsPage,
  SuppliersPage,
  SystemSettingsPage,
  TransferQueuePage,
  WarrantyTrackingPage,
  WorkshopAgeingPage,
  WorkshopBookingsPage,
  WorkshopCalendarPage,
  WorkshopCapacityPage,
  WorkshopCheckInPage,
  WorkshopCollectionPage,
  WorkshopJobPage,
  WorkshopPage,
  WorkshopQueuePage,
  WorkshopTechnicianPage,
  WorkshopPerformancePage,
  WorkshopPrintCentrePage,
  WorkshopQuotePage,
  WorkshopServiceTemplatesPage,
} from "./lazyPages";

const managerOnly = (element: ReactNode) => (
  <ProtectedRoute minimumRole="MANAGER">{element}</ProtectedRoute>
);

const adminOnly = (element: ReactNode) => (
  <ProtectedRoute minimumRole="ADMIN">{element}</ProtectedRoute>
);

const AuthedApp = () => (
  <ProtectedRoute>
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/home" element={<HomeRedirectPage />} />
        <Route path="/account/pin" element={<PinSettingsPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route
          path="/management"
          element={(
            managerOnly(<ManagementDashboardPage />)
          )}
        />
        <Route
          path="/management/dashboard-settings"
          element={(
            managerOnly(<DashboardSettingsPage />)
          )}
        />
        <Route
          path="/management/sales"
          element={(
            managerOnly(<SalesAnalyticsPage />)
          )}
        />
        <Route
          path="/management/workshop"
          element={(
            managerOnly(<WorkshopPerformancePage />)
          )}
        />
        <Route
          path="/management/workshop/templates"
          element={(
            managerOnly(<WorkshopServiceTemplatesPage />)
          )}
        />
        <Route
          path="/management/products"
          element={(
            managerOnly(<ProductSalesAnalyticsPage />)
          )}
        />
        <Route
          path="/management/inventory"
          element={(
            managerOnly(<InventoryVelocityPage />)
          )}
        />
        <Route
          path="/management/suppliers"
          element={(
            managerOnly(<SupplierPerformancePage />)
          )}
        />
        <Route
          path="/management/reordering"
          element={(
            managerOnly(<ReorderSuggestionsPage />)
          )}
        />
        <Route
          path="/management/capacity"
          element={(
            managerOnly(<WorkshopCapacityPage />)
          )}
        />
        <Route
          path="/management/activity"
          element={(
            managerOnly(<ActivityPage />)
          )}
        />
        <Route
          path="/management/refunds"
          element={(
            managerOnly(<RefundOversightPage />)
          )}
        />
        <Route
          path="/refunds"
          element={(
            managerOnly(<RefundOversightPage />)
          )}
        />
        <Route
          path="/management/cash"
          element={(
            managerOnly(<CashOversightPage />)
          )}
        />
        <Route
          path="/management/summary"
          element={(
            managerOnly(<OperationsSummaryPage />)
          )}
        />
        <Route
          path="/management/trade-close"
          element={(
            managerOnly(<DailyTradeClosePage />)
          )}
        />
        <Route
          path="/manager/daily-close"
          element={(
            managerOnly(<DailyTradeClosePage />)
          )}
        />
        <Route
          path="/management/liabilities"
          element={(
            managerOnly(<LiabilitiesReviewPage />)
          )}
        />
        <Route
          path="/management/alerts"
          element={(
            managerOnly(<AlertsCentrePage />)
          )}
        />
        <Route
          path="/management/actions"
          element={(
            managerOnly(<ActionCentrePage />)
          )}
        />
        <Route
          path="/management/investigations"
          element={(
            managerOnly(<StockInvestigationsPage />)
          )}
        />
        <Route
          path="/management/exceptions"
          element={(
            managerOnly(<OperationsExceptionsPage />)
          )}
        />
        <Route
          path="/management/reminders"
          element={(
            managerOnly(<ServiceRemindersPage />)
          )}
        />
        <Route
          path="/management/views"
          element={(
            managerOnly(<SavedViewsPage />)
          )}
        />
        <Route
          path="/management/catalogue"
          element={(
            managerOnly(<SupplierCataloguePage />)
          )}
        />
        <Route
          path="/management/exports"
          element={(
            managerOnly(<ExportHubPage />)
          )}
        />
        <Route
          path="/management/customers"
          element={(
            managerOnly(<CustomerInsightsPage />)
          )}
        />
        <Route
          path="/management/purchasing"
          element={(
            managerOnly(<PurchaseOrderActionPage />)
          )}
        />
        <Route
          path="/management/product-data"
          element={(
            managerOnly(<ProductDataQueuePage />)
          )}
        />
        <Route
          path="/management/pricing"
          element={(
            managerOnly(<PricingExceptionsPage />)
          )}
        />
        <Route
          path="/management/supplier-returns"
          element={(
            managerOnly(<SupplierReturnsPage />)
          )}
        />
        <Route
          path="/management/health"
          element={(
            managerOnly(<OpsHealthPage />)
          )}
        />
        <Route
          path="/management/integrity"
          element={(
            managerOnly(<DataIntegrityPage />)
          )}
        />
        <Route
          path="/management/staff"
          element={(
            managerOnly(<StaffManagementPage />)
          )}
        />
        <Route
          path="/management/admin-review"
          element={(
            adminOnly(<AdminReviewPage />)
          )}
        />
        <Route
          path="/management/onboarding"
          element={(
            adminOnly(<OnboardingPage />)
          )}
        />
        <Route
          path="/management/backups"
          element={(
            adminOnly(<BackupToolkitPage />)
          )}
        />
        <Route
          path="/management/settings"
          element={(
            adminOnly(<SystemSettingsPage />)
          )}
        />
        <Route
          path="/management/docs"
          element={(
            managerOnly(<DocumentationHubPage />)
          )}
        />
        <Route path="/pos" element={<PosPage />} />
        <Route
          path="/sales-history/transactions"
          element={<SalesHistoryPage />}
        />
        <Route
          path="/sales-history/receipt-view"
          element={(
            <NavigationPlaceholderPage
              title="Sales History · Receipt View"
              description="Receipt lookup and reprint workflow will expand here. Current receipt opening still happens from completed sale flows."
              links={[
                { label: "Transaction List", to: "/sales-history/transactions" },
                { label: "Open POS", to: "/pos" },
              ]}
            />
          )}
        />
        <Route
          path="/sales-history/refund"
          element={managerOnly(<RefundOversightPage />)}
        />
        <Route
          path="/sales-history/exchange"
          element={(
            <NavigationPlaceholderPage
              title="Sales History · Exchange"
              description="Exchange handling will build on the same sales-history workflow family without changing the current validated sale and refund rules yet."
              links={[
                { label: "Refund overview", to: "/sales-history/refund" },
                { label: "Transaction List", to: "/sales-history/transactions" },
              ]}
            />
          )}
        />
        <Route path="/workshop" element={<WorkshopPage />} />
        <Route path="/workshop/queue" element={<WorkshopQueuePage />} />
        <Route path="/workshop/new" element={<WorkshopCheckInPage />} />
        <Route path="/workshop/check-in" element={<WorkshopCheckInPage />} />
        <Route path="/workshop/technician" element={<WorkshopTechnicianPage />} />
        <Route path="/workshop/calendar" element={<WorkshopCalendarPage />} />
        <Route
          path="/workshop/analytics"
          element={managerOnly(<WorkshopPerformancePage />)}
        />
        <Route path="/workshop/bookings" element={<WorkshopBookingsPage />} />
        <Route path="/workshop/collection" element={<WorkshopCollectionPage />} />
        <Route path="/workshop/print" element={<WorkshopPrintCentrePage />} />
        <Route path="/workshop/:id" element={<WorkshopJobPage />} />
        <Route
          path="/management/calendar"
          element={(
            managerOnly(<WorkshopCalendarPage />)
          )}
        />
        <Route
          path="/management/staff-rota"
          element={(
            managerOnly(<StaffRotaPage />)
          )}
        />
        <Route
          path="/management/staff-rota/tools"
          element={(
            managerOnly(<StaffRotaToolsPage />)
          )}
        />
        <Route
          path="/management/communications"
          element={(
            managerOnly(<CustomerCommunicationQueuePage />)
          )}
        />
        <Route
          path="/management/warranty"
          element={(
            managerOnly(<WarrantyTrackingPage />)
          )}
        />
        <Route
          path="/management/stock-exceptions"
          element={(
            managerOnly(<StockExceptionsPage />)
          )}
        />
        <Route
          path="/management/transfers"
          element={(
            managerOnly(<TransferQueuePage />)
          )}
        />
        <Route
          path="/management/hire"
          element={(
            managerOnly(<BikeHirePage />)
          )}
        />
        <Route
          path="/management/workshop-ageing"
          element={(
            managerOnly(<WorkshopAgeingPage />)
          )}
        />
        <Route
          path="/management/staff-performance"
          element={(
            managerOnly(<StaffPerformancePage />)
          )}
        />
        <Route path="/tasks" element={<InternalTasksPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/bikes/:bikeId" element={<BikeHistoryPage />} />
        <Route
          path="/customers/bikes"
          element={(
            <NavigationPlaceholderPage
              title="Customers · Customer Bikes"
              description="Customer-bike profiles and registration detail will live here once the dedicated customer equipment workflow is promoted beyond the current profile foundation."
              links={[
                { label: "Customer List", to: "/customers" },
                { label: "Service History", to: "/customers/service-history" },
              ]}
            />
          )}
        />
        <Route
          path="/customers/service-history"
          element={(
            <NavigationPlaceholderPage
              title="Customers · Service History"
              description="This route will become the cross-customer service-history lookup. Individual customer timelines remain available from each customer profile."
              links={[
                { label: "Customer List", to: "/customers" },
                { label: "Loyalty", to: "/customers/loyalty" },
              ]}
            />
          )}
        />
        <Route
          path="/customers/loyalty"
          element={(
            <NavigationPlaceholderPage
              title="Customers · Loyalty"
              description="Loyalty and repeat-customer incentives are scaffolded here for the UX roadmap without changing current customer or sale behavior."
              links={[
                { label: "Customer List", to: "/customers" },
                { label: "Service History", to: "/customers/service-history" },
              ]}
            />
          )}
        />
        <Route path="/customers/:id" element={<CustomerProfilePage />} />
        <Route path="/customers/:id/timeline" element={<CustomerTimelinePage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route
          path="/inventory/products"
          element={(
            <NavigationPlaceholderPage
              title="Inventory · Product List"
              description="Product-list browsing and catalogue maintenance will consolidate here. Current inventory lookup and stock visibility remain available from Stock Levels."
              links={[
                { label: "Stock Levels", to: "/inventory" },
                { label: "Product Data", to: "/management/product-data" },
              ]}
            />
          )}
        />
        <Route
          path="/inventory/products/categories"
          element={(
            <NavigationPlaceholderPage
              title="Inventory · Categories"
              description="Category structure and product grouping will live here as the inventory UX expands beyond raw stock lookup."
              links={[
                { label: "Product List", to: "/inventory/products" },
                { label: "Brands", to: "/inventory/products/brands" },
              ]}
            />
          )}
        />
        <Route
          path="/inventory/products/brands"
          element={(
            <NavigationPlaceholderPage
              title="Inventory · Brands"
              description="Brand-level catalogue navigation and filtering are scaffolded here for the finalized inventory navigation tree."
              links={[
                { label: "Product List", to: "/inventory/products" },
                { label: "Attributes", to: "/inventory/products/attributes" },
              ]}
            />
          )}
        />
        <Route
          path="/inventory/products/attributes"
          element={(
            <NavigationPlaceholderPage
              title="Inventory · Attributes"
              description="Variant attributes, option families, and future merchandising metadata will be surfaced here when the deeper product UX lands."
              links={[
                { label: "Product List", to: "/inventory/products" },
                { label: "Categories", to: "/inventory/products/categories" },
              ]}
            />
          )}
        />
        <Route
          path="/inventory/stocktakes"
          element={(
            managerOnly(<InventoryStocktakesPage />)
          )}
        />
        <Route
          path="/inventory/transfers"
          element={managerOnly(<TransferQueuePage />)}
        />
        <Route
          path="/inventory/adjustments"
          element={managerOnly(
            <NavigationPlaceholderPage
              title="Inventory · Adjustments"
              description="Adjustment history and bulk adjustment entry will live here. Existing stock correctness remains enforced through the current inventory workflows."
              links={[
                { label: "Stock Levels", to: "/inventory" },
                { label: "Stocktake", to: "/inventory/stocktakes" },
              ]}
            />,
          )}
        />
        <Route path="/inventory/locations" element={<InventoryLocationsPage />} />
        <Route path="/inventory/:variantId" element={<InventoryItemPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/purchasing" element={<PurchasingPage />} />
        <Route path="/purchasing/receive-deliveries" element={<SupplierReceivingPage />} />
        <Route path="/purchasing/receiving" element={<SupplierReceivingPage />} />
        <Route path="/purchasing/:id" element={<PurchaseOrderPage />} />
        <Route path="/reports/business-intelligence" element={managerOnly(<BusinessIntelligencePage />)} />
        <Route path="/reports/sales" element={managerOnly(<SalesAnalyticsPage />)} />
        <Route path="/reports/financial" element={managerOnly(<FinancialReportsPage />)} />
        <Route path="/reports/inventory" element={managerOnly(<InventoryVelocityPage />)} />
        <Route path="/reports/workshop" element={managerOnly(<WorkshopPerformancePage />)} />
        <Route path="/reports/staff-performance" element={managerOnly(<StaffPerformancePage />)} />
        <Route path="/rental/calendar" element={managerOnly(<BikeHirePage />)} />
        <Route path="/rental/new" element={managerOnly(<BikeHirePage />)} />
        <Route path="/rental/active" element={managerOnly(<BikeHirePage />)} />
        <Route path="/rental/returns" element={managerOnly(<BikeHirePage />)} />
        <Route path="/rental/history" element={managerOnly(<BikeHirePage />)} />
        <Route
          path="/online-store/orders"
          element={managerOnly(<OnlineStoreOrdersPage />)}
        />
        <Route
          path="/online-store/products"
          element={managerOnly(
            <NavigationPlaceholderPage
              title="Online Store · Products"
              description="Online catalogue publishing controls are scaffolded here for future website and e-commerce expansion."
              links={[
                { label: "Orders", to: "/online-store/orders" },
                { label: "Click & Collect", to: "/online-store/click-collect" },
              ]}
            />,
          )}
        />
        <Route
          path="/online-store/click-collect"
          element={managerOnly(
            <NavigationPlaceholderPage
              title="Online Store · Click & Collect"
              description="Click & collect flow setup will be wired here once online orders and fulfilment workflows are promoted into active product work."
              links={[
                { label: "Orders", to: "/online-store/orders" },
                { label: "Website Builder", to: "/online-store/website-builder" },
              ]}
            />,
          )}
        />
        <Route
          path="/online-store/website-builder"
          element={managerOnly(
            <NavigationPlaceholderPage
              title="Online Store · Website Builder"
              description="Website structure, customer-facing content, and future booking or marketing surfaces are scaffolded here for later expansion."
              links={[
                { label: "Orders", to: "/online-store/orders" },
                { label: "Customer site preview", to: "/" },
              ]}
            />,
          )}
        />
        <Route path="/settings/store-info" element={adminOnly(<SystemSettingsPage />)} />
        <Route path="/settings/staff-list" element={managerOnly(<StaffManagementPage />)} />
        <Route path="/settings/roles-permissions" element={adminOnly(<AdminReviewPage />)} />
        <Route path="/settings/staff-rota" element={managerOnly(<StaffRotaToolsPage />)} />
        <Route
          path="/settings/pos"
          element={adminOnly(
            <NavigationPlaceholderPage
              title="Settings · POS Settings"
              description="POS behavior defaults and operational controls will expand here while the current persisted settings stay available through Store Info."
              links={[
                { label: "Store Info", to: "/settings/store-info" },
                { label: "Receipts", to: "/settings/receipts" },
              ]}
            />,
          )}
        />
        <Route
          path="/settings/workshop"
          element={adminOnly(
            <NavigationPlaceholderPage
              title="Settings · Workshop Settings"
              description="Workshop defaults and workflow controls will live here as the settings UX grows around the existing workshop service behavior."
              links={[
                { label: "Store Info", to: "/settings/store-info" },
                { label: "Inventory Settings", to: "/settings/inventory" },
              ]}
            />,
          )}
        />
        <Route
          path="/settings/inventory"
          element={adminOnly(
            <NavigationPlaceholderPage
              title="Settings · Inventory Settings"
              description="Inventory thresholds, handling defaults, and later stock-control preferences are scaffolded here for the finalized settings tree."
              links={[
                { label: "Store Info", to: "/settings/store-info" },
                { label: "Payments", to: "/settings/payments" },
              ]}
            />,
          )}
        />
        <Route
          path="/settings/payments"
          element={adminOnly(
            <NavigationPlaceholderPage
              title="Settings · Payments"
              description="Payment processor and tender configuration will be exposed here without changing the current validated tender and till workflows."
              links={[
                { label: "Store Info", to: "/settings/store-info" },
                { label: "Integrations", to: "/settings/integrations" },
              ]}
            />,
          )}
        />
        <Route
          path="/settings/integrations"
          element={adminOnly(
            <NavigationPlaceholderPage
              title="Settings · Integrations"
              description="External integration controls and connection status will be surfaced here as operational integrations mature."
              links={[
                { label: "Store Info", to: "/settings/store-info" },
                { label: "System / Diagnostics", to: "/settings/system-diagnostics" },
              ]}
            />,
          )}
        />
        <Route
          path="/settings/receipts"
          element={adminOnly(
            <NavigationPlaceholderPage
              title="Settings · Receipts"
              description="Receipt formatting and print-output configuration are scaffolded here while current receipt generation remains unchanged."
              links={[
                { label: "Store Info", to: "/settings/store-info" },
                { label: "POS Settings", to: "/settings/pos" },
              ]}
            />,
          )}
        />
        <Route path="/settings/system-diagnostics" element={adminOnly(<OpsHealthPage />)} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  </ProtectedRoute>
);

export const App = () => {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/receipt-upload/:token" element={<CashReceiptUploadPage />} />
        <Route path="/customer-capture" element={<CustomerCapturePage />} />
        <Route path="/customer-capture/entry/:station" element={<CustomerCapturePage />} />
        <Route path="/customer-capture/:token" element={<CustomerCapturePage />} />
        <Route path="/public/workshop/:token" element={<WorkshopQuotePage />} />
        <Route path="/quote/:token" element={<WorkshopQuotePage />} />
        <Route path="/book-workshop" element={<PublicWorkshopBookingPage />} />
        <Route path="/bookings/:token" element={<PublicWorkshopBookingManagePage />} />
        <Route path="/site/book-workshop" element={<PublicWorkshopBookingPage />} />
        <Route path="/site/bookings/:token" element={<PublicWorkshopBookingManagePage />} />
        <Route path="/account" element={<CustomerAccountDashboardPage />} />
        <Route path="/account/login" element={<CustomerAccountLoginPage />} />
        <Route path="/account/access/:token" element={<CustomerAccountAccessPage />} />
        <Route path="/" element={<CustomerSitePage variant="home" />} />
        <Route path="/services" element={<CustomerSitePage variant="services" />} />
        <Route path="/repairs" element={<CustomerSitePage variant="workshop" />} />
        <Route path="/contact" element={<CustomerSitePage variant="contact" />} />
        <Route path="/site" element={<CustomerSitePage variant="home" />} />
        <Route path="/site/services" element={<CustomerSitePage variant="services" />} />
        <Route path="/site/workshop" element={<CustomerSitePage variant="workshop" />} />
        <Route path="/site/contact" element={<CustomerSitePage variant="contact" />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/variants/:variantId/bike-tag/print"
          element={(
            <ProtectedRoute>
              <BikeTagPrintPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/inventory/:variantId/label"
          element={(
            <ProtectedRoute>
              <ProductLabelPrintPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/sales/:saleId/invoice/print"
          element={(
            <ProtectedRoute>
              <SalesInvoicePrintPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/sales/:saleId/receipt/print"
          element={(
            <ProtectedRoute>
              <SalesReceiptPrintPage />
            </ProtectedRoute>
          )}
        />
        <Route path="*" element={<AuthedApp />} />
      </Routes>
    </Suspense>
  );
};
