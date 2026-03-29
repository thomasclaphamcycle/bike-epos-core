import { type UserOperationalRole } from "@prisma/client";

type WorkshopStaffingCandidate = {
  operationalRole: UserOperationalRole | null;
  isTechnician: boolean;
};

export const isWorkshopOperationalRole = (value: UserOperationalRole | null) =>
  value === "WORKSHOP" || value === "MIXED";

export const filterWorkshopTechnicians = <T extends WorkshopStaffingCandidate>(staff: T[]) => {
  const usesTechnicianFlags = staff.some((entry) => entry.isTechnician);
  const usesOperationalRoleTags = staff.some((entry) => isWorkshopOperationalRole(entry.operationalRole));

  if (usesTechnicianFlags) {
    return {
      staff: staff.filter((entry) => entry.isTechnician),
      usesTechnicianFlags,
      usesOperationalRoleTags,
      fallbackToBroadStaffing: false,
    };
  }

  if (usesOperationalRoleTags) {
    return {
      staff: staff.filter((entry) => isWorkshopOperationalRole(entry.operationalRole)),
      usesTechnicianFlags,
      usesOperationalRoleTags,
      fallbackToBroadStaffing: false,
    };
  }

  return {
    staff,
    usesTechnicianFlags,
    usesOperationalRoleTags,
    fallbackToBroadStaffing: true,
  };
};
