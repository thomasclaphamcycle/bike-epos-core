import { BikeServiceScheduleType, Prisma, WorkshopServicePricingMode } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { serializeBikeServiceSchedule } from "./bikeServiceScheduleService";
import { getWorkshopSettings, type WorkshopSettings } from "./configurationService";

type SerializedBikeServiceSchedule = ReturnType<typeof serializeBikeServiceSchedule>;
type RawBikeServiceSchedule = Parameters<typeof serializeBikeServiceSchedule>[0];

type CommercialBikeContext = {
  bike: {
    id: string;
    bikeType: string | null;
    motorBrand: string | null;
    motorModel: string | null;
  } | null;
  serviceSchedules: RawBikeServiceSchedule[];
  serviceSummary: {
    linkedJobCount: number;
    openJobCount: number;
    completedJobCount: number;
    firstJobAt: Date | null;
    latestJobAt: Date | null;
    latestCompletedAt: Date | null;
  };
  currentWorkDescriptions?: string[];
  customerId?: string | null;
  bikeDescription?: string | null;
  allowLinkBikeRecordPrompt?: boolean;
};

const commercialTemplateSelect = Prisma.validator<Prisma.WorkshopServiceTemplateSelect>()({
  id: true,
  name: true,
  category: true,
  description: true,
  sortOrder: true,
  defaultDurationMinutes: true,
  pricingMode: true,
});

type CommercialTemplateRecord = Prisma.WorkshopServiceTemplateGetPayload<{
  select: typeof commercialTemplateSelect;
}>;

export type WorkshopCommercialRecommendationPriority = "HIGH" | "MEDIUM" | "LOW";
export type WorkshopCommercialRecommendationCode =
  | "OVERDUE_SERVICE"
  | "DUE_SERVICE"
  | "LONG_GAP"
  | "NEW_BIKE_BASELINE"
  | "E_BIKE_HEALTH"
  | "CARE_PLAN"
  | "LINK_BIKE_RECORD";
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
  code: WorkshopCommercialRecommendationCode;
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
    pricingMode: WorkshopServicePricingMode;
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

type CommercialRuleProfile = {
  serviceType: WorkshopCommercialServiceType;
  displayName: string;
  templateKeywords: string[];
  workKeywords: string[];
  problemSnippet: string;
};

const EMPTY_COMMERCIAL_INSIGHTS: WorkshopCommercialInsights = {
  enabled: false,
  summary: {
    recommendationCount: 0,
    highestPriority: null,
    leadText: null,
  },
  recommendations: [],
};

const PRIORITY_RANK: Record<WorkshopCommercialRecommendationPriority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

const SCHEDULE_STATUS_RANK: Record<SerializedBikeServiceSchedule["dueStatus"], number> = {
  OVERDUE: 0,
  DUE: 1,
  UPCOMING: 2,
  INACTIVE: 3,
};

const DEFAULT_SERVICE_PROFILE: CommercialRuleProfile = {
  serviceType: "GENERAL_SERVICE",
  displayName: "general service",
  templateKeywords: ["service", "tune", "maintenance", "inspection", "safety"],
  workKeywords: ["service", "tune", "maintenance", "inspection", "safety"],
  problemSnippet:
    "General service due. Inspect brakes, drivetrain, wheels, tyres, and safety-critical items.",
};

const SCHEDULE_RULE_PROFILES: Record<BikeServiceScheduleType, CommercialRuleProfile> = {
  GENERAL_SERVICE: DEFAULT_SERVICE_PROFILE,
  SAFETY_CHECK: {
    serviceType: "SAFETY_CHECK",
    displayName: "safety check",
    templateKeywords: ["safety", "inspection", "check", "assessment", "diagnostic"],
    workKeywords: ["safety", "inspection", "check", "assessment", "diagnostic"],
    problemSnippet:
      "Safety check due. Inspect safety-critical items before the next ride.",
  },
  BRAKES: {
    serviceType: "BRAKES",
    displayName: "brake service",
    templateKeywords: ["brake", "bleed", "pad", "rotor", "caliper"],
    workKeywords: ["brake", "bleed", "pad", "rotor", "caliper"],
    problemSnippet:
      "Brake service due. Check pads, braking surface, adjustment, and fluid or cable condition.",
  },
  DRIVETRAIN: {
    serviceType: "DRIVETRAIN",
    displayName: "drivetrain service",
    templateKeywords: ["drivetrain", "chain", "cassette", "gear", "transmission"],
    workKeywords: ["drivetrain", "chain", "cassette", "gear", "transmission"],
    problemSnippet:
      "Drivetrain service due. Check chain wear, cassette, indexing, and drivetrain efficiency.",
  },
  SUSPENSION: {
    serviceType: "SUSPENSION",
    displayName: "suspension service",
    templateKeywords: ["suspension", "fork", "shock", "damper", "seal"],
    workKeywords: ["suspension", "fork", "shock", "damper", "seal"],
    problemSnippet:
      "Suspension service due. Inspect fork and shock performance, seals, and setup.",
  },
  E_BIKE_SYSTEM: {
    serviceType: "E_BIKE_SYSTEM",
    displayName: "e-bike system check",
    templateKeywords: ["e-bike", "ebike", "motor", "battery", "diagnostic", "electrical"],
    workKeywords: ["e-bike", "ebike", "motor", "battery", "diagnostic", "electrical"],
    problemSnippet:
      "E-bike system check due. Inspect motor, battery, firmware, and electrical connections.",
  },
  TYRES: {
    serviceType: "TYRES",
    displayName: "tyre and wheel check",
    templateKeywords: ["tyre", "tire", "wheel", "tubeless", "puncture"],
    workKeywords: ["tyre", "tire", "wheel", "tubeless", "puncture"],
    problemSnippet:
      "Tyre and wheel check due. Inspect tyres, puncture protection, wheel wear, and setup.",
  },
  OTHER: DEFAULT_SERVICE_PROFILE,
};

const LINK_BIKE_RECORD_PROFILE: CommercialRuleProfile = {
  serviceType: "BIKE_RECORD",
  displayName: "bike record linkage",
  templateKeywords: [],
  workKeywords: [],
  problemSnippet: "Create a linked bike record so future service prompts stay tied to this bike.",
};

const CARE_PLAN_PROFILE: CommercialRuleProfile = {
  serviceType: "CARE_PLAN",
  displayName: "care plan setup",
  templateKeywords: [],
  workKeywords: [],
  problemSnippet:
    "Add a service schedule after this visit so future reminder and due-service prompts stay accurate.",
};

const normalizeSearchText = (value: string | null | undefined) =>
  value
    ?.trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";

const describeDaysSince = (days: number) => {
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "1 day ago";
  }
  return `${days} days ago`;
};

const diffWholeDays = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));

const toSourceSignals = (values: Array<string | null | undefined>) =>
  values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);

const dedupeRecommendations = (recommendations: WorkshopCommercialRecommendation[]) => {
  const seen = new Set<string>();
  const deduped: WorkshopCommercialRecommendation[] = [];

  for (const recommendation of recommendations) {
    const key = `${recommendation.code}:${recommendation.serviceType}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(recommendation);
  }

  return deduped;
};

const buildInsightsPayload = (
  enabled: boolean,
  recommendations: WorkshopCommercialRecommendation[],
): WorkshopCommercialInsights => {
  if (!enabled) {
    return EMPTY_COMMERCIAL_INSIGHTS;
  }

  return {
    enabled: true,
    summary: {
      recommendationCount: recommendations.length,
      highestPriority: recommendations[0]?.priority ?? null,
      leadText: recommendations[0]?.title ?? null,
    },
    recommendations,
  };
};

const findBestTemplateMatch = (
  templates: CommercialTemplateRecord[],
  profile: CommercialRuleProfile,
  extraKeywords: string[] = [],
) => {
  const keywords = [...new Set([...profile.templateKeywords, ...extraKeywords].map(normalizeSearchText).filter(Boolean))];
  if (keywords.length === 0) {
    return null;
  }

  const scored = templates
    .map((template) => {
      const name = normalizeSearchText(template.name);
      const category = normalizeSearchText(template.category);
      const description = normalizeSearchText(template.description);

      let score = 0;
      for (const keyword of keywords) {
        if (name.includes(keyword)) {
          score += 4;
        }
        if (category && category.includes(keyword)) {
          score += 2;
        }
        if (description && description.includes(keyword)) {
          score += 1;
        }
      }

      return {
        template,
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || left.template.sortOrder - right.template.sortOrder
      || left.template.name.localeCompare(right.template.name),
    );

  const best = scored[0]?.template ?? null;
  if (!best) {
    return null;
  }

  return {
    id: best.id,
    name: best.name,
    category: best.category,
    defaultDurationMinutes: best.defaultDurationMinutes,
    pricingMode: best.pricingMode,
  };
};

const workAlreadyMentionsProfile = (
  profile: CommercialRuleProfile,
  currentWorkDescriptions: string[] | undefined,
  matchedTemplateName?: string | null,
) => {
  const haystack = normalizeSearchText((currentWorkDescriptions ?? []).join(" "));
  if (!haystack) {
    return false;
  }

  const keywords = [
    ...profile.workKeywords,
    ...(matchedTemplateName ? [matchedTemplateName] : []),
  ]
    .map(normalizeSearchText)
    .filter((keyword) => keyword.length >= 4);

  return keywords.some((keyword) => haystack.includes(keyword));
};

const sortedScheduleRecommendations = (
  schedules: SerializedBikeServiceSchedule[],
) =>
  schedules
    .filter((schedule) => schedule.isActive && (schedule.dueStatus === "OVERDUE" || schedule.dueStatus === "DUE"))
    .sort((left, right) =>
      SCHEDULE_STATUS_RANK[left.dueStatus] - SCHEDULE_STATUS_RANK[right.dueStatus]
      || (left.nextDueAt?.getTime() ?? Number.POSITIVE_INFINITY) - (right.nextDueAt?.getTime() ?? Number.POSITIVE_INFINITY)
      || right.updatedAt.getTime() - left.updatedAt.getTime(),
    );

const buildScheduleRecommendation = (
  schedule: SerializedBikeServiceSchedule,
  templates: CommercialTemplateRecord[],
  currentWorkDescriptions: string[] | undefined,
): WorkshopCommercialRecommendation | null => {
  const profile = SCHEDULE_RULE_PROFILES[schedule.type] ?? DEFAULT_SERVICE_PROFILE;
  const matchedTemplate = findBestTemplateMatch(
    templates,
    profile,
    [schedule.title, schedule.typeLabel, schedule.description ?? ""],
  );

  if (workAlreadyMentionsProfile(profile, currentWorkDescriptions, matchedTemplate?.name)) {
    return null;
  }

  const isOverdue = schedule.dueStatus === "OVERDUE";

  return {
    code: isOverdue ? "OVERDUE_SERVICE" : "DUE_SERVICE",
    priority: isOverdue ? "HIGH" : "MEDIUM",
    serviceType: profile.serviceType,
    title: isOverdue
      ? `Offer ${profile.displayName} while the bike is in`
      : `Flag ${profile.displayName} on this visit`,
    summary: isOverdue
      ? "This bike already has a due service signal, so it is a strong workshop add-on to discuss now."
      : "This bike has an upcoming due service signal, so staff can mention it while the customer is already deciding work.",
    why: `${schedule.title} is ${schedule.dueStatus === "OVERDUE" ? "overdue" : "due"} (${schedule.dueSummaryText}).`,
    suggestedProblemSnippet: profile.problemSnippet,
    matchedTemplate,
    sourceSignals: toSourceSignals([
      `${schedule.typeLabel} schedule`,
      schedule.dueSummaryText,
      schedule.lastServiceSummaryText,
    ]),
  };
};

const buildLongGapRecommendation = (
  daysSinceLastCompleted: number,
  latestCompletedAt: Date,
  templates: CommercialTemplateRecord[],
  currentWorkDescriptions: string[] | undefined,
): WorkshopCommercialRecommendation | null => {
  const matchedTemplate = findBestTemplateMatch(templates, DEFAULT_SERVICE_PROFILE);
  if (workAlreadyMentionsProfile(DEFAULT_SERVICE_PROFILE, currentWorkDescriptions, matchedTemplate?.name)) {
    return null;
  }

  const priority: WorkshopCommercialRecommendationPriority =
    daysSinceLastCompleted >= 365 ? "HIGH" : "MEDIUM";

  return {
    code: "LONG_GAP",
    priority,
    serviceType: "GENERAL_SERVICE",
    title: "Offer a general service follow-up",
    summary:
      "There is a meaningful gap since the last linked completed workshop visit, so a broader service conversation is commercially relevant and easy to explain.",
    why: `Last linked completed workshop service was ${daysSinceLastCompleted} days ago (${latestCompletedAt.toLocaleDateString()}).`,
    suggestedProblemSnippet: DEFAULT_SERVICE_PROFILE.problemSnippet,
    matchedTemplate,
    sourceSignals: toSourceSignals([
      `Last completed service ${describeDaysSince(daysSinceLastCompleted)}`,
      `Completed linked jobs ${daysSinceLastCompleted > 0 ? "exist" : "recorded today"}`,
    ]),
  };
};

const buildNewBikeBaselineRecommendation = (
  templates: CommercialTemplateRecord[],
  currentWorkDescriptions: string[] | undefined,
): WorkshopCommercialRecommendation | null => {
  const profile = SCHEDULE_RULE_PROFILES.SAFETY_CHECK;
  const matchedTemplate = findBestTemplateMatch(templates, profile, ["baseline", "first"]);
  if (workAlreadyMentionsProfile(profile, currentWorkDescriptions, matchedTemplate?.name)) {
    return null;
  }

  return {
    code: "NEW_BIKE_BASELINE",
    priority: "MEDIUM",
    serviceType: "SAFETY_CHECK",
    title: "Start with a baseline safety check",
    summary:
      "This bike record has no linked workshop history yet, so a first structured check gives the shop a safer starting point and opens future service conversations.",
    why: "No linked workshop history has been recorded against this bike yet.",
    suggestedProblemSnippet: profile.problemSnippet,
    matchedTemplate,
    sourceSignals: toSourceSignals([
      "No linked workshop jobs yet",
      "Structured bike record exists",
    ]),
  };
};

const buildEBikeRecommendation = (
  templates: CommercialTemplateRecord[],
  currentWorkDescriptions: string[] | undefined,
  bike: NonNullable<CommercialBikeContext["bike"]>,
  lastCompletedAt: Date | null,
): WorkshopCommercialRecommendation | null => {
  const profile = SCHEDULE_RULE_PROFILES.E_BIKE_SYSTEM;
  const matchedTemplate = findBestTemplateMatch(templates, profile);
  if (workAlreadyMentionsProfile(profile, currentWorkDescriptions, matchedTemplate?.name)) {
    return null;
  }

  return {
    code: "E_BIKE_HEALTH",
    priority: "MEDIUM",
    serviceType: "E_BIKE_SYSTEM",
    title: "Offer an e-bike system check",
    summary:
      "This bike has e-bike hardware recorded, so a system-health prompt is grounded in the bike profile and easy to justify when workshop work is already being discussed.",
    why: lastCompletedAt
      ? `E-bike hardware is recorded and the last linked completed service was on ${lastCompletedAt.toLocaleDateString()}.`
      : "E-bike hardware is recorded, but no linked completed service is on file yet.",
    suggestedProblemSnippet: profile.problemSnippet,
    matchedTemplate,
    sourceSignals: toSourceSignals([
      bike.motorBrand ? `Motor ${bike.motorBrand}` : "Bike type E-bike",
      bike.motorModel ? `Model ${bike.motorModel}` : null,
      lastCompletedAt ? `Last completed service ${lastCompletedAt.toLocaleDateString()}` : "No completed service on file",
    ]),
  };
};

const buildCarePlanRecommendation = (
  completedJobCount: number,
): WorkshopCommercialRecommendation => ({
  code: "CARE_PLAN",
  priority: "LOW",
  serviceType: "CARE_PLAN",
  title: "Add a future care-plan schedule",
  summary:
    "The bike has real workshop history but no active service schedules, so future reminder and due-service prompts will be weaker until a care plan is captured.",
  why: "Active service schedules are missing even though this bike already has completed workshop history.",
  suggestedProblemSnippet: CARE_PLAN_PROFILE.problemSnippet,
  matchedTemplate: null,
  sourceSignals: toSourceSignals([
    `${completedJobCount} completed linked job${completedJobCount === 1 ? "" : "s"}`,
    "0 active service schedules",
  ]),
});

const buildLinkBikeRecordRecommendation = (
  bikeDescription: string | null | undefined,
): WorkshopCommercialRecommendation => ({
  code: "LINK_BIKE_RECORD",
  priority: "MEDIUM",
  serviceType: "BIKE_RECORD",
  title: "Create a linked bike record before this job goes quiet",
  summary:
    "Without a saved bike record, future service reminders, due-history prompts, and bike-specific upsell cues will all stay weaker than they should be.",
  why: bikeDescription
    ? `The job currently relies on free-text bike details only (${bikeDescription}).`
    : "The job currently has no linked reusable bike record.",
  suggestedProblemSnippet: LINK_BIKE_RECORD_PROFILE.problemSnippet,
  matchedTemplate: null,
  sourceSignals: toSourceSignals([
    "No linked reusable bike record",
    bikeDescription ? "Bike described in free text only" : null,
  ]),
});

export const getWorkshopCommercialSupportData = async () => {
  const workshopSettings = await getWorkshopSettings();
  if (!workshopSettings.commercialSuggestionsEnabled) {
    return {
      workshopSettings,
      templates: [] as CommercialTemplateRecord[],
    };
  }

  const templates = await prisma.workshopServiceTemplate.findMany({
    where: { isActive: true },
    select: commercialTemplateSelect,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return {
    workshopSettings,
    templates,
  };
};

export const getWorkshopCommercialBikeContext = async (bikeId: string) => {
  const bike = await prisma.customerBike.findUnique({
    where: { id: bikeId },
    select: {
      id: true,
      bikeType: true,
      motorBrand: true,
      motorModel: true,
      serviceSchedules: {
        orderBy: [{ isActive: "desc" }, { nextDueAt: "asc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          bikeId: true,
          type: true,
          title: true,
          description: true,
          intervalMonths: true,
          intervalMileage: true,
          lastServiceAt: true,
          lastServiceMileage: true,
          nextDueAt: true,
          nextDueMileage: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      workshopJobs: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          completedAt: true,
          closedAt: true,
        },
      },
    },
  });

  if (!bike) {
    return null;
  }

  const completedJobs = bike.workshopJobs.filter((job) => job.completedAt !== null);
  const sortedLatestActivity = bike.workshopJobs
    .map((job) => job.completedAt ?? job.createdAt)
    .sort((left, right) => right.getTime() - left.getTime());

  const openJobCount = bike.workshopJobs.filter((job) =>
    job.closedAt === null && job.status !== "COMPLETED" && job.status !== "CANCELLED").length;

  return {
    bike: {
      id: bike.id,
      bikeType: bike.bikeType,
      motorBrand: bike.motorBrand,
      motorModel: bike.motorModel,
    },
    serviceSchedules: bike.serviceSchedules,
    serviceSummary: {
      linkedJobCount: bike.workshopJobs.length,
      openJobCount,
      completedJobCount: completedJobs.length,
      firstJobAt: bike.workshopJobs
        .map((job) => job.createdAt)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null,
      latestJobAt: sortedLatestActivity[0] ?? null,
      latestCompletedAt: completedJobs
        .map((job) => job.completedAt)
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
    },
  } satisfies Pick<CommercialBikeContext, "bike" | "serviceSchedules" | "serviceSummary">;
};

export const buildWorkshopCommercialInsights = (
  context: CommercialBikeContext,
  input: {
    workshopSettings: WorkshopSettings;
    templates: CommercialTemplateRecord[];
    now?: Date;
  },
): WorkshopCommercialInsights => {
  const { workshopSettings, templates } = input;
  const now = input.now ?? new Date();

  if (!workshopSettings.commercialSuggestionsEnabled) {
    return EMPTY_COMMERCIAL_INSIGHTS;
  }

  const recommendations: WorkshopCommercialRecommendation[] = [];

  if (context.allowLinkBikeRecordPrompt && !context.bike && context.customerId) {
    recommendations.push(buildLinkBikeRecordRecommendation(context.bikeDescription));
  }

  if (!context.bike) {
    const orderedWithoutBike = dedupeRecommendations(recommendations)
      .sort((left, right) =>
        PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
        || left.title.localeCompare(right.title),
      )
      .slice(0, 3);
    return buildInsightsPayload(true, orderedWithoutBike);
  }

  const serializedSchedules = context.serviceSchedules.map((schedule) =>
    serializeBikeServiceSchedule(schedule, now),
  );

  const scheduleRecommendations = sortedScheduleRecommendations(serializedSchedules)
    .map((schedule) => buildScheduleRecommendation(schedule, templates, context.currentWorkDescriptions))
    .filter((recommendation): recommendation is WorkshopCommercialRecommendation => Boolean(recommendation));

  recommendations.push(...scheduleRecommendations);

  const hasScheduleDrivenServicePrompt = scheduleRecommendations.length > 0;
  const latestCompletedAt = context.serviceSummary.latestCompletedAt;
  const daysSinceLastCompleted = latestCompletedAt ? diffWholeDays(latestCompletedAt, now) : null;
  const isEBike = context.bike.bikeType === "E_BIKE" || Boolean(context.bike.motorBrand || context.bike.motorModel);

  if (
    !hasScheduleDrivenServicePrompt
    && latestCompletedAt
    && daysSinceLastCompleted !== null
    && daysSinceLastCompleted >= workshopSettings.commercialLongGapDays
    && daysSinceLastCompleted >= workshopSettings.commercialRecentServiceCooldownDays
  ) {
    const longGapRecommendation = buildLongGapRecommendation(
      daysSinceLastCompleted,
      latestCompletedAt,
      templates,
      context.currentWorkDescriptions,
    );
    if (longGapRecommendation) {
      recommendations.push(longGapRecommendation);
    }
  }

  if (
    context.serviceSummary.linkedJobCount === 0
    && context.serviceSummary.openJobCount === 0
    && !hasScheduleDrivenServicePrompt
  ) {
    const baselineRecommendation = buildNewBikeBaselineRecommendation(
      templates,
      context.currentWorkDescriptions,
    );
    if (baselineRecommendation) {
      recommendations.push(baselineRecommendation);
    }
  }

  if (
    isEBike
    && !recommendations.some((recommendation) => recommendation.serviceType === "E_BIKE_SYSTEM")
    && (
      daysSinceLastCompleted === null
      || daysSinceLastCompleted >= workshopSettings.commercialRecentServiceCooldownDays
      || context.serviceSummary.linkedJobCount === 0
    )
  ) {
    const ebikeRecommendation = buildEBikeRecommendation(
      templates,
      context.currentWorkDescriptions,
      context.bike,
      latestCompletedAt,
    );
    if (ebikeRecommendation) {
      recommendations.push(ebikeRecommendation);
    }
  }

  const activeScheduleCount = serializedSchedules.filter((schedule) => schedule.isActive).length;
  if (
    context.serviceSummary.completedJobCount > 0
    && activeScheduleCount === 0
  ) {
    recommendations.push(buildCarePlanRecommendation(context.serviceSummary.completedJobCount));
  }

  const orderedRecommendations = dedupeRecommendations(recommendations)
    .sort((left, right) =>
      PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
      || (right.matchedTemplate ? 0 : 1) - (left.matchedTemplate ? 0 : 1)
      || left.title.localeCompare(right.title),
    )
    .slice(0, 3);

  return buildInsightsPayload(true, orderedRecommendations);
};
