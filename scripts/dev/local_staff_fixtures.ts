import { UserOperationalRole, UserRole } from "@prisma/client";

export type LocalDevStaffFixture = {
  username: string;
  email: string;
  name: string;
  role: UserRole;
  operationalRole: UserOperationalRole;
  isActive: boolean;
  pin: string;
  matchUsernames?: string[];
};

export const LOCAL_DEV_STAFF_PASSWORD = process.env.LOCAL_STAFF_PASSWORD || "ChangeMe123!";

export const LOCAL_DEV_STAFF_FIXTURES: LocalDevStaffFixture[] = [
  {
    username: "dom",
    email: "dom@corepos.local",
    name: "Dom",
    role: UserRole.STAFF,
    operationalRole: UserOperationalRole.WORKSHOP,
    isActive: true,
    pin: "2468",
  },
  {
    username: "eric",
    email: "eric@corepos.local",
    name: "Eric",
    role: UserRole.STAFF,
    operationalRole: UserOperationalRole.SALES,
    isActive: true,
    pin: "1357",
  },
  {
    username: "mike",
    email: "mike@corepos.local",
    name: "Mike",
    role: UserRole.STAFF,
    operationalRole: UserOperationalRole.WORKSHOP,
    isActive: true,
    pin: "4321",
  },
  {
    username: "thomas",
    email: "thomas@corepos.local",
    name: "Thomas",
    role: UserRole.ADMIN,
    operationalRole: UserOperationalRole.MIXED,
    isActive: true,
    pin: "8642",
    matchUsernames: ["thomas@corepos.local"],
  },
];
