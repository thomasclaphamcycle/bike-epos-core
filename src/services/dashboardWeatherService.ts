import { listShopSettings } from "./configurationService";

type WeatherStatus = "ready" | "missing_location" | "unavailable";

type DailyWeatherSnapshot = {
  summary: string;
  highC: number;
  lowC: number;
  precipitationMm: number;
};

export type DashboardWeatherResponse = {
  status: WeatherStatus;
  source: "open-meteo";
  locationLabel?: string;
  message?: string;
  today?: DailyWeatherSnapshot;
  tomorrow?: DailyWeatherSnapshot;
};

type OpenMeteoForecastResponse = {
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
  };
};

type OpenMeteoGeocodeResponse = {
  results?: Array<{
    latitude: number;
    longitude: number;
    name: string;
    admin1?: string;
    country?: string;
  }>;
};

type ResolvedStoreLocation = {
  latitude: number;
  longitude: number;
  label: string;
};

const FORECAST_BASE_URL = process.env.OPEN_METEO_FORECAST_URL?.trim() || "https://api.open-meteo.com/v1/forecast";
const GEOCODE_BASE_URL = process.env.OPEN_METEO_GEOCODE_URL?.trim() || "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_FETCH_TIMEOUT_MS = Number(process.env.COREPOS_WEATHER_TIMEOUT_MS || 5000);

const weatherCodeSummary = (code: number) => {
  switch (code) {
    case 0:
      return "Clear";
    case 1:
      return "Mainly clear";
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
    case 48:
      return "Fog";
    case 51:
    case 53:
    case 55:
      return "Drizzle";
    case 56:
    case 57:
      return "Freezing drizzle";
    case 61:
    case 63:
    case 65:
      return "Rain";
    case 66:
    case 67:
      return "Freezing rain";
    case 71:
    case 73:
    case 75:
      return "Snow";
    case 77:
      return "Snow grains";
    case 80:
    case 81:
    case 82:
      return "Rain showers";
    case 85:
    case 86:
      return "Snow showers";
    case 95:
      return "Thunderstorm";
    case 96:
    case 99:
      return "Thunderstorm with hail";
    default:
      return "Weather update";
  }
};

const roundWeatherValue = (value: number) => Math.round(value * 10) / 10;

const buildSnapshot = (
  weatherCode: number | undefined,
  highC: number | undefined,
  lowC: number | undefined,
  precipitationMm: number | undefined,
): DailyWeatherSnapshot | undefined => {
  if (
    weatherCode === undefined
    || highC === undefined
    || lowC === undefined
    || precipitationMm === undefined
  ) {
    return undefined;
  }

  return {
    summary: weatherCodeSummary(weatherCode),
    highC: roundWeatherValue(highC),
    lowC: roundWeatherValue(lowC),
    precipitationMm: roundWeatherValue(precipitationMm),
  };
};

const fetchJson = async <T>(url: URL): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Weather provider request failed (${response.status})`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
};

const resolveGeocodedLocation = async (query: string): Promise<ResolvedStoreLocation | null> => {
  const url = new URL(GEOCODE_BASE_URL);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetchJson<OpenMeteoGeocodeResponse>(url);
  const result = response.results?.[0];
  if (!result) {
    return null;
  }

  const labelParts = [result.name, result.admin1, result.country].filter(Boolean);

  return {
    latitude: result.latitude,
    longitude: result.longitude,
    label: labelParts.join(", "),
  };
};

const resolveStoreLocation = async (): Promise<ResolvedStoreLocation | null> => {
  const settings = await listShopSettings();
  const { city, latitude, longitude, postcode } = settings.store;

  if (latitude !== null && longitude !== null) {
    const labelParts = [city, postcode].filter(Boolean);
    return {
      latitude,
      longitude,
      label: labelParts.join(" · ") || settings.store.name,
    };
  }

  const query = postcode || city;
  if (!query) {
    return null;
  }

  return resolveGeocodedLocation(query);
};

const getStubWeather = async (): Promise<DashboardWeatherResponse> => {
  const location = await resolveStoreLocation();
  if (!location) {
    return {
      status: "missing_location",
      source: "open-meteo",
      message: "Store location is missing. Update Store Info to enable dashboard weather.",
    };
  }

  return {
    status: "ready",
    source: "open-meteo",
    locationLabel: location.label,
    today: {
      summary: "Partly cloudy",
      highC: 14,
      lowC: 7,
      precipitationMm: 0.6,
    },
    tomorrow: {
      summary: "Light rain",
      highC: 12,
      lowC: 6,
      precipitationMm: 2.4,
    },
  };
};

export const getDashboardWeather = async (): Promise<DashboardWeatherResponse> => {
  if (process.env.COREPOS_WEATHER_STUB === "1") {
    return getStubWeather();
  }

  let location: ResolvedStoreLocation | null = null;

  try {
    location = await resolveStoreLocation();
  } catch {
    return {
      status: "unavailable",
      source: "open-meteo",
      message: "Weather temporarily unavailable.",
    };
  }

  if (!location) {
    return {
      status: "missing_location",
      source: "open-meteo",
      message: "Store location is missing. Update Store Info to enable dashboard weather.",
    };
  }

  try {
    const url = new URL(FORECAST_BASE_URL);
    url.searchParams.set("latitude", `${location.latitude}`);
    url.searchParams.set("longitude", `${location.longitude}`);
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum");
    url.searchParams.set("forecast_days", "2");
    url.searchParams.set("timezone", "auto");

    const response = await fetchJson<OpenMeteoForecastResponse>(url);
    const today = buildSnapshot(
      response.daily?.weather_code?.[0],
      response.daily?.temperature_2m_max?.[0],
      response.daily?.temperature_2m_min?.[0],
      response.daily?.precipitation_sum?.[0],
    );
    const tomorrow = buildSnapshot(
      response.daily?.weather_code?.[1],
      response.daily?.temperature_2m_max?.[1],
      response.daily?.temperature_2m_min?.[1],
      response.daily?.precipitation_sum?.[1],
    );

    if (!today) {
      throw new Error("Weather provider returned incomplete daily data");
    }

    return {
      status: "ready",
      source: "open-meteo",
      locationLabel: location.label,
      today,
      ...(tomorrow ? { tomorrow } : {}),
    };
  } catch {
    return {
      status: "unavailable",
      source: "open-meteo",
      message: "Weather temporarily unavailable.",
    };
  }
};
