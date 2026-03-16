import { apiGet } from "./client";

export type SystemVersionResponse = {
  app: {
    version: string;
    label: string;
  };
};

export const getSystemVersion = () =>
  apiGet<SystemVersionResponse>("/api/system/version");
