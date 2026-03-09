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

const AuthedApp = () => (
  <ProtectedRoute>
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/pos" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
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
