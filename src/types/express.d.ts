import type { AuthenticatedUser } from "./auth";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
      location?: {
        id: string;
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
