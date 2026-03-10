import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { toRoleHomeRoute } from "../utils/homeRoute";

export const HomeRedirectPage = () => {
  const { user } = useAuth();
  return <Navigate to={toRoleHomeRoute(user?.role)} replace />;
};
