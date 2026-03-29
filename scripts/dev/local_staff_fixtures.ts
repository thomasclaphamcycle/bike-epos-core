import { UserOperationalRole, UserRole } from "@prisma/client";

export type LocalDevStaffFixture = {
  username: string;
  email: string;
  name: string;
  role: UserRole;
  operationalRole: UserOperationalRole;
  isTechnician: boolean;
  isActive: boolean;
  pin: string;
  matchUsernames?: string[];
  matchEmails?: string[];
};

export const LOCAL_DEV_STAFF_PASSWORD = process.env.LOCAL_STAFF_PASSWORD || "ChangeMe123!";

export const LOCAL_DEV_STAFF_FIXTURES: LocalDevStaffFixture[] = [
  {
    username: "dom",
    email: "dom@corepos.local",
    name: "Dom",
    role: UserRole.STAFF,
    operationalRole: UserOperationalRole.WORKSHOP,
    isTechnician: true,
    isActive: true,
    pin: "2468",
    matchUsernames: ["dom@claphamcycle.com"],
    matchEmails: ["dom@claphamcycle.com"],
  },
  {
    username: "eric",
    email: "eric@corepos.local",
    name: "Eric",
    role: UserRole.STAFF,
    operationalRole: UserOperationalRole.SALES,
    isTechnician: false,
    isActive: true,
    pin: "1357",
    matchUsernames: ["eric@claphamcycle.com"],
    matchEmails: ["eric@claphamcycle.com"],
  },
  {
    username: "mike",
    email: "mike@corepos.local",
    name: "Mike",
    role: UserRole.STAFF,
    operationalRole: UserOperationalRole.WORKSHOP,
    isTechnician: true,
    isActive: true,
    pin: "4321",
    matchUsernames: ["mike@claphamcycle.com"],
    matchEmails: ["mike@claphamcycle.com"],
  },
  {
    username: "thomas",
    email: "thomas@corepos.local",
    name: "Thomas",
    role: UserRole.ADMIN,
    operationalRole: UserOperationalRole.MIXED,
    isTechnician: true,
    isActive: true,
    pin: "8642",
    matchUsernames: ["thomas@corepos.local"],
  },
];
