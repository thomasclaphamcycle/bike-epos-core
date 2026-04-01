import {
  workshopCommercialPriorityClassName,
  workshopCommercialPriorityLabel,
  workshopCommercialServiceTypeLabel,
  type WorkshopCommercialInsights,
} from "../features/workshop/commercialInsights";

type WorkshopCommercialInsightsPanelProps = {
  insights: WorkshopCommercialInsights | null | undefined;
  title?: string;
  description?: string;
  dataTestId?: string;
  maxItems?: number;
  compact?: boolean;
  onUseSnippet?: (snippet: string) => void;
  useSnippetLabel?: string;
};

export const WorkshopCommercialInsightsPanel = ({
  insights,
  title = "Workshop commercial prompts",
  description = "Grounded suggestions from linked bike history, care-plan timing, and current workshop context.",
  dataTestId,
  maxItems = 3,
  compact = false,
  onUseSnippet,
  useSnippetLabel = "Use wording",
}: WorkshopCommercialInsightsPanelProps) => {
  if (!insights?.enabled || insights.recommendations.length === 0) {
    return null;
  }

  const recommendations = insights.recommendations.slice(0, maxItems);

  return (
    <section
      className={`workshop-commercial-insights${compact ? " workshop-commercial-insights--compact" : ""}`}
      data-testid={dataTestId}
    >
      <div className="workshop-commercial-insights__header">
        <div>
          <span className="table-secondary">Commercial intelligence</span>
          <h3>{title}</h3>
          {description ? <p className="muted-text">{description}</p> : null}
        </div>
        <div className="workshop-commercial-insights__summary">
          <strong>{insights.summary.recommendationCount}</strong>
          <span>
            {insights.summary.recommendationCount === 1 ? "prompt" : "prompts"}
          </span>
        </div>
      </div>

      <div className="workshop-commercial-insights__list">
        {recommendations.map((recommendation) => (
          <article
            key={`${recommendation.code}-${recommendation.serviceType}`}
            className="workshop-commercial-insights__card"
          >
            <div className="workshop-commercial-insights__card-header">
              <div>
                <div className="actions-inline">
                  <span className={workshopCommercialPriorityClassName(recommendation.priority)}>
                    {workshopCommercialPriorityLabel(recommendation.priority)}
                  </span>
                  <span className="table-secondary">
                    {workshopCommercialServiceTypeLabel(recommendation.serviceType)}
                  </span>
                </div>
                <strong>{recommendation.title}</strong>
              </div>
            </div>

            <p>{recommendation.summary}</p>
            <p className="muted-text">
              <strong>Why:</strong> {recommendation.why}
            </p>

            {recommendation.sourceSignals.length > 0 ? (
              <div className="workshop-commercial-insights__signals">
                {recommendation.sourceSignals.map((signal) => (
                  <span key={signal} className="workshop-commercial-insights__signal">
                    {signal}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="workshop-commercial-insights__meta">
              {recommendation.matchedTemplate ? (
                <span>
                  <strong>Template match:</strong> {recommendation.matchedTemplate.name}
                </span>
              ) : null}
              {recommendation.suggestedProblemSnippet ? (
                <span>
                  <strong>Suggested wording:</strong> {recommendation.suggestedProblemSnippet}
                </span>
              ) : null}
            </div>

            {onUseSnippet && recommendation.suggestedProblemSnippet ? (
              <div className="actions-inline">
                <button
                  type="button"
                  className="button-link button-link-compact"
                  onClick={() => onUseSnippet(recommendation.suggestedProblemSnippet ?? "")}
                >
                  {useSnippetLabel}
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
};
