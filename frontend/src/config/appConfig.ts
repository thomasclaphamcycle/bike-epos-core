import { useEffect, useState } from "react";
import { apiGet } from "../api/client";

type StoreDailyOpeningHours = {
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
};

type StoreOpeningHours = Record<
  "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY",
  StoreDailyOpeningHours
>;

export type AppConfig = {
  store: {
    name: string;
    businessName: string;
    email: string;
    phone: string;
    website: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    region: string;
    postcode: string;
    country: string;
    defaultCurrency: string;
    timeZone: string;
    logoUrl: string;
    uploadedLogoPath: string;
    preferredLogoUrl: string;
    footerText: string;
    openingHours: StoreOpeningHours;
  };
  pos: {
    defaultTaxRatePercent: number;
    barcodeSearchAutoFocus: boolean;
  };
  workshop: {
    defaultJobDurationMinutes: number;
    defaultDepositPence: number;
    maxBookingsPerDay: number;
    requestTimingMessage: string;
  };
  operations: {
    lowStockThreshold: number;
    dashboardWeatherEnabled: boolean;
  };
};

type AppConfigResponse = {
  config: AppConfig;
};

const DEFAULT_OPENING_HOURS: StoreOpeningHours = {
  MONDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  TUESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  WEDNESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  THURSDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  FRIDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  SATURDAY: { isClosed: false, opensAt: "09:00", closesAt: "16:30" },
  SUNDAY: { isClosed: true, opensAt: "", closesAt: "" },
};

const DEFAULT_APP_CONFIG: AppConfig = {
  store: {
    name: "Bike EPOS",
    businessName: "Bike EPOS",
    email: "",
    phone: "",
    website: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postcode: "",
    country: "United Kingdom",
    defaultCurrency: "GBP",
    timeZone: "Europe/London",
    logoUrl: "",
    uploadedLogoPath: "",
    preferredLogoUrl: "",
    footerText: "Thank you for your custom.",
    openingHours: DEFAULT_OPENING_HOURS,
  },
  pos: {
    defaultTaxRatePercent: 20,
    barcodeSearchAutoFocus: true,
  },
  workshop: {
    defaultJobDurationMinutes: 60,
    defaultDepositPence: 1000,
    maxBookingsPerDay: 8,
    requestTimingMessage:
      "Choose a preferred workshop date and drop-off preference. The shop will confirm the final timing if a precise slot is needed.",
  },
  operations: {
    lowStockThreshold: 3,
    dashboardWeatherEnabled: true,
  },
};

let cachedAppConfig: AppConfig | null = null;
let appConfigPromise: Promise<AppConfig> | null = null;

export const invalidateAppConfigCache = () => {
  cachedAppConfig = null;
  appConfigPromise = null;
};

export const getAppConfig = async () => {
  if (cachedAppConfig) {
    return cachedAppConfig;
  }

  if (!appConfigPromise) {
    appConfigPromise = apiGet<AppConfigResponse>("/api/config")
      .then((payload) => {
        cachedAppConfig = payload.config;
        return payload.config;
      })
      .catch((error) => {
        appConfigPromise = null;
        throw error;
      });
  }

  return appConfigPromise;
};

export const useAppConfig = () => {
  const [config, setConfig] = useState<AppConfig>(cachedAppConfig ?? DEFAULT_APP_CONFIG);

  useEffect(() => {
    let cancelled = false;

    void getAppConfig()
      .then((nextConfig) => {
        if (!cancelled) {
          setConfig(nextConfig);
        }
      })
      .catch(() => {
        // Keep safe defaults if config cannot be loaded for a page.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return config;
};
