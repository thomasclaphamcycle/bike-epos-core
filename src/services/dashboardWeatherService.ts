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

type PostcodesIoLookupResponse = {
  status?: number;
  result?: {
    postcode: string;
    latitude: number;
    longitude: number;
    country?: string;
    admin_district?: string;
    admin_ward?: string;
    region?: string;
  } | null;
};

type ResolvedStoreLocation = {
  latitude: number;
  longitude: number;
  label: string;
};

type StoreLocationResolution =
  | { status: "ready"; location: ResolvedStoreLocation }
  | { status: "missing" }
  | { status: "unresolvable" };

const FORECAST_BASE_URL = process.env.OPEN_METEO_FORECAST_URL?.trim() || "https://api.open-meteo.com/v1/forecast";
const GEOCODE_BASE_URL = process.env.OPEN_METEO_GEOCODE_URL?.trim() || "https://geocoding-api.open-meteo.com/v1/search";
const POSTCODES_IO_BASE_URL = process.env.POSTCODES_IO_BASE_URL?.trim() || "https://api.postcodes.io/postcodes";
const WEATHER_FETCH_TIMEOUT_MS = Number(process.env.COREPOS_WEATHER_TIMEOUT_MS || 5000);
const UK_POSTCODE_REGEX = /^([A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}|GIR 0AA)$/i;

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

const normalizePostcode = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();

const isLikelyUkPostcode = (value: string) => UK_POSTCODE_REGEX.test(value);

const fetchResponse = async (url: URL): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchJson = async <T>(url: URL): Promise<T> => {
  const response = await fetchResponse(url);
  if (!response.ok) {
    throw new Error(`Weather provider request failed (${response.status})`);
  }
  return await response.json() as T;
};

const buildLocationLabel = (primary: string, secondary?: string, country?: string) =>
  [primary, secondary, country].filter(Boolean).join(", ");

const resolveUkPostcodeLocation = async (postcode: string): Promise<ResolvedStoreLocation | null> => {
  const trimmedBaseUrl = POSTCODES_IO_BASE_URL.replace(/\/+$/, "");
  const url = new URL(`${trimmedBaseUrl}/${encodeURIComponent(postcode)}`);
  const response = await fetchResponse(url);

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Postcode lookup request failed (${response.status})`);
  }

  const payload = await response.json() as PostcodesIoLookupResponse;
  const result = payload.result;
  if (!result) {
    return null;
  }

  return {
    latitude: result.latitude,
    longitude: result.longitude,
    label: buildLocationLabel(
      result.postcode || postcode,
      result.admin_district || result.admin_ward || result.region,
      result.country,
    ) || postcode,
  };
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

  return {
    latitude: result.latitude,
    longitude: result.longitude,
    label: buildLocationLabel(result.name, result.admin1, result.country) || query,
  };
};

const resolveStoreLocation = async (): Promise<StoreLocationResolution> => {
  const settings = await listShopSettings();
  const postcode = normalizePostcode(settings.store.postcode);

  if (!postcode) {
    return { status: "missing" };
  }

  if (isLikelyUkPostcode(postcode)) {
    const resolvedUkPostcode = await resolveUkPostcodeLocation(postcode);
    if (resolvedUkPostcode) {
      return {
        status: "ready",
        location: resolvedUkPostcode,
      };
    }
  }

  const geocoded = await resolveGeocodedLocation(postcode);
  if (!geocoded) {
    return { status: "unresolvable" };
  }

  return {
    status: "ready",
    location: geocoded,
  };
};

const buildMissingLocationResponse = (): DashboardWeatherResponse => ({
  status: "missing_location",
  source: "open-meteo",
  message: "Weather unavailable. Set the store postcode in Settings.",
});

const buildUnresolvableLocationResponse = (): DashboardWeatherResponse => ({
  status: "unavailable",
  source: "open-meteo",
  message: "Weather location could not be resolved from the store postcode. Check Store Info.",
});

const getStubWeather = async (): Promise<DashboardWeatherResponse> => {
  const resolution = await resolveStoreLocation();
  if (resolution.status === "missing") {
    return buildMissingLocationResponse();
  }
  if (resolution.status === "unresolvable") {
    return buildUnresolvableLocationResponse();
  }
  const { location } = resolution;

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
    const resolution = await resolveStoreLocation();
    if (resolution.status === "missing") {
      return buildMissingLocationResponse();
    }
    if (resolution.status === "unresolvable") {
      return buildUnresolvableLocationResponse();
    }
    location = resolution.location;
  } catch {
    return {
      status: "unavailable",
      source: "open-meteo",
      message: "Weather temporarily unavailable.",
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
