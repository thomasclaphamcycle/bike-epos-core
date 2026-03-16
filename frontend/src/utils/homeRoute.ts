export type AppRole = "STAFF" | "MANAGER" | "ADMIN" | undefined;

export const toRoleHomeRoute = (_role: AppRole) => "/dashboard";
