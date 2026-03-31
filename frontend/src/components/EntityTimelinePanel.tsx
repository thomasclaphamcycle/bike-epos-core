import { useEffect, useState } from "react";
import { apiGet } from "../api/client";
import { useToasts } from "./ToastProvider";

export type EntityTimelineEvent = {
  id: string;
  occurredAt: string;
  label: string;
  description: string;
};

type EntityTimelineResponse = {
  entityType: string;
  entityId: string;
  events: EntityTimelineEvent[];
};

type EntityTimelinePanelProps = {
  entityType: "WORKSHOP_JOB" | "CUSTOMER" | "BIKE";
  entityId?: string | null;
  hint: string;
  emptyState: string;
  loadingLabel?: string;
};

export const EntityTimelinePanel = ({
  entityType,
  entityId,
  hint,
  emptyState,
  loadingLabel = "Loading timeline...",
}: EntityTimelinePanelProps) => {
  const { error } = useToasts();
  const [payload, setPayload] = useState<EntityTimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!entityId) {
      setPayload(null);
      return;
    }

    let cancelled = false;

    const loadTimeline = async () => {
      setLoading(true);
      try {
        const response = await apiGet<EntityTimelineResponse>(
          `/api/events?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
        );

        if (!cancelled) {
          setPayload(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : "Failed to load timeline";
          error(message);
          setPayload(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadTimeline();

    return () => {
      cancelled = true;
    };
  }, [entityId, entityType, error, reloadToken]);

  const events = payload?.events ?? [];

  return (
    <div className="workshop-job-event-timeline">
      <div className="workshop-job-event-timeline__header">
        <p className="workshop-job-status-panel__hint">{hint}</p>
        <button
          type="button"
          className="button-link"
          onClick={() => setReloadToken((value) => value + 1)}
          disabled={loading || !entityId}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {events.length ? (
        <ol className="workshop-job-event-timeline__list">
          {events.map((event) => (
            <li key={event.id} className="workshop-job-event-timeline__item">
              <div className="workshop-job-event-timeline__marker" />
              <div className="workshop-job-event-timeline__content">
                <div className="workshop-job-event-timeline__item-header">
                  <strong>{event.label}</strong>
                  <span className="table-secondary">{new Date(event.occurredAt).toLocaleString()}</span>
                </div>
                <p>{event.description}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="restricted-panel info-panel">
          {loading ? loadingLabel : emptyState}
        </div>
      )}
    </div>
  );
};
