import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiGet, apiPost, ApiError } from "../api/client";

type AuthUser = {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  role: "STAFF" | "MANAGER" | "ADMIN";
  isActive: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
};

const normalizeIdentifierToEmail = (identifier: string) => {
  const value = identifier.trim();
  if (!value) {
    return "";
  }
  if (value.includes("@")) {
    return value.toLowerCase();
  }
  return `${value.toLowerCase()}@local`;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await apiGet<{ user: AuthUser }>("/api/auth/me");
      setUser(response.user);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setUser(null);
        return;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const login = useCallback(async (identifier: string, password: string) => {
    const email = normalizeIdentifierToEmail(identifier);
    await apiPost<{ user: AuthUser }>("/api/auth/login", { email, password });
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiPost<unknown>("/api/auth/logout", {});
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      refresh,
    }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
