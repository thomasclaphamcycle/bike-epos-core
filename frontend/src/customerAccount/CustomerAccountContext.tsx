import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiGet, apiPost } from "../api/client";

export type CustomerAccountSession = {
  authenticated: boolean;
  account?: {
    id: string;
    email: string;
    status: "ACTIVE" | "DISABLED";
    createdAt: string;
    lastAccessLinkSentAt: string | null;
    lastLoginAt: string | null;
  };
  customer?: {
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    email: string | null;
    phone: string | null;
  };
  stats?: {
    bikeCount: number;
    activeJobCount: number;
  };
  bikes?: Array<{
    id: string;
    displayName: string;
  }>;
};

type CustomerAccountContextValue = {
  session: CustomerAccountSession;
  isLoading: boolean;
  refreshSession: () => Promise<CustomerAccountSession>;
  logout: () => Promise<void>;
};

const unauthenticatedSession: CustomerAccountSession = {
  authenticated: false,
};

const CustomerAccountContext = createContext<CustomerAccountContextValue | null>(null);

const loadCustomerSession = async () => {
  try {
    return await apiGet<CustomerAccountSession>("/api/customer-auth/session");
  } catch {
    return unauthenticatedSession;
  }
};

export const CustomerAccountProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<CustomerAccountSession>(unauthenticatedSession);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const nextSession = await loadCustomerSession();
    setSession(nextSession);
    setIsLoading(false);
    return nextSession;
  }, []);

  useEffect(() => {
    void refreshSession();
  }, []);

  const logout = useCallback(async () => {
    await apiPost("/api/customer-auth/logout");
    setSession(unauthenticatedSession);
  }, []);

  const value = useMemo<CustomerAccountContextValue>(
    () => ({
      session,
      isLoading,
      refreshSession,
      logout,
    }),
    [isLoading, logout, refreshSession, session],
  );

  return (
    <CustomerAccountContext.Provider value={value}>
      {children}
    </CustomerAccountContext.Provider>
  );
};

export const useCustomerAccount = () => {
  const context = useContext(CustomerAccountContext);
  if (!context) {
    throw new Error("useCustomerAccount must be used within CustomerAccountProvider");
  }
  return context;
};
