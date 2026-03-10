import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { toRoleHomeRoute } from "../utils/homeRoute";

type StaffRole = "STAFF" | "MANAGER" | "ADMIN";

const roleRank: Record<StaffRole, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
};

export const ProtectedRoute = ({
  children,
  minimumRole,
}: {
  children: React.ReactNode;
  minimumRole?: StaffRole;
}) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="page-shell"><p>Checking session...</p></div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (minimumRole && roleRank[user.role] < roleRank[minimumRole]) {
    return <Navigate to={toRoleHomeRoute(user.role)} replace />;
  }

  return <>{children}</>;
};
