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
