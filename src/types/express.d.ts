import type { AuthenticatedCustomerAccount, AuthenticatedUser } from "./auth";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: AuthenticatedUser;
      customerAccount?: AuthenticatedCustomerAccount;
      location?: {
        id: string;
        locationId?: string;
        stockLocationId?: string | null;
        name: string;
        code: string | null;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      };
    }
  }
}

export {};
