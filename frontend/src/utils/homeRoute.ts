export type AppRole = "STAFF" | "MANAGER" | "ADMIN" | undefined;

export const toRoleHomeRoute = (role: AppRole) => {
  if (role === "ADMIN") {
    return "/management/staff";
  }
  if (role === "MANAGER") {
    return "/management";
  }
  return "/dashboard";
};
