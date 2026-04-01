export type WorkshopCommercialRecommendationPriority = "HIGH" | "MEDIUM" | "LOW";

export type WorkshopCommercialServiceType =
  | "GENERAL_SERVICE"
  | "SAFETY_CHECK"
  | "BRAKES"
  | "DRIVETRAIN"
  | "SUSPENSION"
  | "E_BIKE_SYSTEM"
  | "TYRES"
  | "CARE_PLAN"
  | "BIKE_RECORD";

export type WorkshopCommercialRecommendation = {
  code: string;
  priority: WorkshopCommercialRecommendationPriority;
  serviceType: WorkshopCommercialServiceType;
  title: string;
  summary: string;
  why: string;
  suggestedProblemSnippet: string | null;
  matchedTemplate: {
    id: string;
    name: string;
    category: string | null;
    defaultDurationMinutes: number | null;
    pricingMode: "FIXED_PRICE_SERVICE" | "TIME_AND_PARTS";
  } | null;
  sourceSignals: string[];
};

export type WorkshopCommercialInsights = {
  enabled: boolean;
  summary: {
    recommendationCount: number;
    highestPriority: WorkshopCommercialRecommendationPriority | null;
    leadText: string | null;
  };
  recommendations: WorkshopCommercialRecommendation[];
};

const PRIORITY_LABELS: Record<WorkshopCommercialRecommendationPriority, string> = {
  HIGH: "High signal",
  MEDIUM: "Worth raising",
  LOW: "Follow-up idea",
};

const SERVICE_TYPE_LABELS: Record<WorkshopCommercialServiceType, string> = {
  GENERAL_SERVICE: "General service",
  SAFETY_CHECK: "Safety check",
  BRAKES: "Brake service",
  DRIVETRAIN: "Drivetrain service",
  SUSPENSION: "Suspension service",
  E_BIKE_SYSTEM: "E-bike system",
  TYRES: "Tyres and wheels",
  CARE_PLAN: "Care plan",
  BIKE_RECORD: "Bike record",
};

export const workshopCommercialPriorityLabel = (
  priority: WorkshopCommercialRecommendationPriority,
) => PRIORITY_LABELS[priority];

export const workshopCommercialPriorityClassName = (
  priority: WorkshopCommercialRecommendationPriority,
) => `workshop-commercial-insights__priority workshop-commercial-insights__priority--${priority.toLocaleLowerCase()}`;

export const workshopCommercialServiceTypeLabel = (
  serviceType: WorkshopCommercialServiceType,
) => SERVICE_TYPE_LABELS[serviceType];
