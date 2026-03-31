import {
  getOperationsSettings,
  listStoreInfoSettings,
} from "./configurationService";

type WeatherStatus = "ready" | "missing_location" | "unavailable";

type DailyWeatherSnapshot = {
  summary: string;
  highC: number;
  lowC: number;
  precipitationMm: number;
};

type TradingWeatherPointKind = "sun" | "part-sun" | "cloud" | "rain" | "showers";

type TradingWeatherPoint = {
  time: string;
  label: string;
  summary: string;
  kind: TradingWeatherPointKind;
  temperatureC: number;
  precipitationMm: number;
  precipitationProbabilityPercent: number;
};

export type DashboardWeatherResponse = {
  status: WeatherStatus;
  source: "open-meteo";
  locationLabel?: string;
  message?: string;
  today?: DailyWeatherSnapshot;
  tomorrow?: DailyWeatherSnapshot;
  tradingDayTimeline?: TradingWeatherPoint[];
};

type OpenMeteoForecastResponse = {
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
  };
  hourly?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m?: number[];
    precipitation?: number[];
    precipitation_probability?: number[];
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
  | { status: "disabled" }
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

const weatherCodeKind = (code: number): TradingWeatherPointKind => {
  if (code === 0) {
    return "sun";
  }
  if (code === 1 || code === 2) {
    return "part-sun";
  }
  if (code === 3 || code === 45 || code === 48) {
    return "cloud";
  }
  if (code >= 80 && code <= 82) {
    return "showers";
  }
  return "rain";
};

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

const isTradingHour = (timeValue: string) => {
  const date = new Date(timeValue);
  const hour = date.getHours();
  return hour >= 9 && hour <= 19;
};

const formatTradingTimeLabel = (timeValue: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timeValue));

const buildTradingTimelinePoint = (
  timeValue: string | undefined,
  weatherCode: number | undefined,
  temperatureC: number | undefined,
  precipitationMm: number | undefined,
  precipitationProbabilityPercent: number | undefined,
): TradingWeatherPoint | undefined => {
  if (
    !timeValue
    || weatherCode === undefined
    || temperatureC === undefined
    || precipitationMm === undefined
    || precipitationProbabilityPercent === undefined
  ) {
    return undefined;
  }

  return {
    time: timeValue,
    label: formatTradingTimeLabel(timeValue),
    summary: weatherCodeSummary(weatherCode),
    kind: weatherCodeKind(weatherCode),
    temperatureC: roundWeatherValue(temperatureC),
    precipitationMm: roundWeatherValue(precipitationMm),
    precipitationProbabilityPercent: Math.round(precipitationProbabilityPercent),
  };
};

const shouldKeepTradingPoint = (current: TradingWeatherPoint, previous: TradingWeatherPoint) => {
  if (current.kind !== previous.kind) {
    return true;
  }

  const currentWet = current.precipitationMm > 0.1 || current.precipitationProbabilityPercent >= 35;
  const previousWet = previous.precipitationMm > 0.1 || previous.precipitationProbabilityPercent >= 35;
  if (currentWet !== previousWet) {
    return true;
  }

  return Math.abs(current.temperatureC - previous.temperatureC) >= 4;
};

const MAX_TRADING_TIMELINE_POINTS = 8;

const fillTradingTimelinePoints = (
  tradingPoints: TradingWeatherPoint[],
  selectedIndexes: Set<number>,
  maxPoints: number,
) => {
  if (selectedIndexes.size >= maxPoints || tradingPoints.length <= selectedIndexes.size) {
    return;
  }

  const candidateIndexes = tradingPoints
    .map((_, index) => index)
    .filter((index) => !selectedIndexes.has(index));

  if (!candidateIndexes.length) {
    return;
  }

  const remainingSlots = maxPoints - selectedIndexes.size;
  for (let slot = 0; slot < remainingSlots && slot < candidateIndexes.length; slot += 1) {
    const position = Math.round(((slot + 1) * (candidateIndexes.length + 1)) / (remainingSlots + 1)) - 1;
    const clampedPosition = Math.min(candidateIndexes.length - 1, Math.max(0, position));
    selectedIndexes.add(candidateIndexes[clampedPosition]);
  }
};

const buildTradingDayTimeline = (
  times: string[] | undefined,
  weatherCodes: number[] | undefined,
  temperatures: number[] | undefined,
  precipitation: number[] | undefined,
  precipitationProbability: number[] | undefined,
): TradingWeatherPoint[] => {
  if (!times?.length) {
    return [];
  }

  const tradingPoints = times
    .map((timeValue, index) => buildTradingTimelinePoint(
      timeValue,
      weatherCodes?.[index],
      temperatures?.[index],
      precipitation?.[index],
      precipitationProbability?.[index],
    ))
    .filter((point): point is TradingWeatherPoint => Boolean(point))
    .filter((point) => isTradingHour(point.time));

  if (!tradingPoints.length) {
    return [];
  }

  const selectedIndexes = new Set<number>();
  selectedIndexes.add(0);
  selectedIndexes.add(tradingPoints.length - 1);

  tradingPoints.forEach((point, index) => {
    if (index === 0 || index === tradingPoints.length - 1) {
      return;
    }
    if (shouldKeepTradingPoint(point, tradingPoints[index - 1])) {
      selectedIndexes.add(index);
    }
  });

  if (selectedIndexes.size > MAX_TRADING_TIMELINE_POINTS) {
    const sortedIndexes = Array.from(selectedIndexes).sort((left, right) => left - right);
    const preservedIndexes = new Set<number>([0, tradingPoints.length - 1]);
    const middleIndexes = sortedIndexes.filter((index) => !preservedIndexes.has(index));
    const middleSlots = MAX_TRADING_TIMELINE_POINTS - preservedIndexes.size;

    for (let slot = 0; slot < middleSlots && slot < middleIndexes.length; slot += 1) {
      const position = Math.round((slot * (middleIndexes.length - 1)) / Math.max(1, middleSlots - 1));
      preservedIndexes.add(middleIndexes[position]);
    }

    return Array.from(preservedIndexes)
      .sort((left, right) => left - right)
      .map((index) => tradingPoints[index]);
  }

  fillTradingTimelinePoints(tradingPoints, selectedIndexes, MAX_TRADING_TIMELINE_POINTS);

  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .map((index) => tradingPoints[index]);
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
  const [operationsSettings, store] = await Promise.all([
    getOperationsSettings(),
    listStoreInfoSettings(),
  ]);

  if (!operationsSettings.dashboardWeatherEnabled) {
    return { status: "disabled" };
  }

  if (store.latitude !== null && store.longitude !== null) {
    return {
      status: "ready",
      location: {
        latitude: store.latitude,
        longitude: store.longitude,
        label:
          buildLocationLabel(
            store.name || store.businessName || "Store",
            store.city || store.region || undefined,
            store.country || undefined,
          ) || "Store",
      },
    };
  }

  const postcode = normalizePostcode(store.postcode);

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

const buildDisabledWeatherResponse = (): DashboardWeatherResponse => ({
  status: "unavailable",
  source: "open-meteo",
  message: "Weather is disabled in system settings.",
});

const buildUnresolvableLocationResponse = (): DashboardWeatherResponse => ({
  status: "unavailable",
  source: "open-meteo",
  message: "Weather location could not be resolved from the store postcode. Check Store Info.",
});

const getStubWeather = async (): Promise<DashboardWeatherResponse> => {
  const resolution = await resolveStoreLocation();
  if (resolution.status === "disabled") {
    return buildDisabledWeatherResponse();
  }
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
    tradingDayTimeline: [
      {
        time: "2026-03-15T09:00",
        label: "09:00",
        summary: "Partly cloudy",
        kind: "part-sun",
        temperatureC: 9,
        precipitationMm: 0,
        precipitationProbabilityPercent: 10,
      },
      {
        time: "2026-03-15T12:00",
        label: "12:00",
        summary: "Clear",
        kind: "sun",
        temperatureC: 13,
        precipitationMm: 0,
        precipitationProbabilityPercent: 5,
      },
      {
        time: "2026-03-15T16:00",
        label: "16:00",
        summary: "Rain showers",
        kind: "showers",
        temperatureC: 12,
        precipitationMm: 0.6,
        precipitationProbabilityPercent: 60,
      },
      {
        time: "2026-03-15T19:00",
        label: "19:00",
        summary: "Overcast",
        kind: "cloud",
        temperatureC: 8,
        precipitationMm: 0,
        precipitationProbabilityPercent: 15,
      },
    ],
  };
};

export const getDashboardWeather = async (): Promise<DashboardWeatherResponse> => {
  if (process.env.COREPOS_WEATHER_STUB === "1") {
    return getStubWeather();
  }

  let location: ResolvedStoreLocation | null = null;

  try {
    const resolution = await resolveStoreLocation();
    if (resolution.status === "disabled") {
      return buildDisabledWeatherResponse();
    }
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
    url.searchParams.set("hourly", "weather_code,temperature_2m,precipitation,precipitation_probability");
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
    const tradingDayTimeline = buildTradingDayTimeline(
      response.hourly?.time,
      response.hourly?.weather_code,
      response.hourly?.temperature_2m,
      response.hourly?.precipitation,
      response.hourly?.precipitation_probability,
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
      ...(tradingDayTimeline.length ? { tradingDayTimeline } : {}),
    };
  } catch {
    return {
      status: "unavailable",
      source: "open-meteo",
      message: "Weather temporarily unavailable.",
    };
  }
};
