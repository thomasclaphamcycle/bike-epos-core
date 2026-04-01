import { UserRole } from "@prisma/client";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
  username: string;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  authSource: "session" | "header";
};

export type AuthenticatedCustomerAccount = {
  id: string;
  customerId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  status: "ACTIVE" | "DISABLED";
  lastLoginAt: Date | null;
  authSource: "session";
};
