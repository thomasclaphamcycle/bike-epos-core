import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { SavedViewControls } from "../components/SavedViewControls";
import { useToasts } from "../components/ToastProvider";

type AuditEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorRole: string | null;
  actorId: string | null;
  metadata: unknown;
  createdAt: string;
};

type AuditResponse = {
  filters: {
    entityType: string | null;
    entityId: string | null;
    action: string | null;
    from: string | null;
    to: string | null;
    limit: number;
  };
  events: AuditEvent[];
};

const formatJsonPreview = (value: unknown) => {
  if (value === null || value === undefined) {
    return "-";
  }

  try {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  } catch {
    return "[unavailable]";
  }
};

const uniqueValues = (rows: AuditEvent[], key: "action" | "entityType") =>
  Array.from(new Set(rows.map((row) => row[key]).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );

export const ActivityPage = () => {
  const { error } = useToasts();

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [limit, setLimit] = useState("100");
  const [actorFilter, setActorFilter] = useState("");

  const applySavedFilters = (filters: Record<string, string>) => {
    setFromDate(filters.fromDate ?? "");
    setToDate(filters.toDate ?? "");
    setAction(filters.action ?? "");
    setEntityType(filters.entityType ?? "");
    setEntityId(filters.entityId ?? "");
    setLimit(filters.limit ?? "100");
    setActorFilter(filters.actorFilter ?? "");
    void loadActivity({
      fromDate: filters.fromDate ?? "",
      toDate: filters.toDate ?? "",
      action: filters.action ?? "",
      entityType: filters.entityType ?? "",
      entityId: filters.entityId ?? "",
      limit: filters.limit ?? "100",
    });
  };

  const loadActivity = async (nextFilters?: {
    fromDate?: string;
    toDate?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    limit?: string;
  }) => {
    setLoading(true);
    try {
      const resolvedFromDate = nextFilters?.fromDate ?? fromDate;
      const resolvedToDate = nextFilters?.toDate ?? toDate;
      const resolvedAction = nextFilters?.action ?? action;
      const resolvedEntityType = nextFilters?.entityType ?? entityType;
      const resolvedEntityId = nextFilters?.entityId ?? entityId;
      const resolvedLimit = nextFilters?.limit ?? limit;

      const params = new URLSearchParams();
      if (resolvedFromDate) {
        params.set("from", resolvedFromDate);
      }
      if (resolvedToDate) {
        params.set("to", resolvedToDate);
      }
      if (resolvedAction) {
        params.set("action", resolvedAction);
      }
      if (resolvedEntityType) {
        params.set("entityType", resolvedEntityType);
      }
      if (resolvedEntityId.trim()) {
        params.set("entityId", resolvedEntityId.trim());
      }
      if (resolvedLimit.trim()) {
        params.set("limit", resolvedLimit.trim());
      }

      const query = params.toString();
      const payload = await apiGet<AuditResponse>(`/api/audit${query ? `?${query}` : ""}`);
      setEvents(payload.events || []);
    } catch (loadError) {
      setEvents([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actionOptions = useMemo(() => uniqueValues(events, "action"), [events]);
  const entityOptions = useMemo(() => uniqueValues(events, "entityType"), [events]);

  const filteredEvents = useMemo(() => {
    const actorNeedle = actorFilter.trim().toLowerCase();
    if (!actorNeedle) {
      return events;
    }

    return events.filter((event) => {
      const actor = `${event.actorRole ?? ""} ${event.actorId ?? ""}`.trim().toLowerCase();
      return actor.includes(actorNeedle);
    });
  }, [actorFilter, events]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Audit & Activity</h1>
            <p className="muted-text">
              Recent system activity for operational visibility. Use it to confirm who changed what during a trial, with server-side filters aligned to the existing audit API and a local actor filter on the returned rows.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadActivity()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label>
            From
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label>
            Action
            <select value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="">All actions</option>
              {actionOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Entity
            <select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
              <option value="">All entities</option>
              {entityOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="grow">
            Entity ID
            <input
              value={entityId}
              onChange={(event) => setEntityId(event.target.value)}
              placeholder="Optional exact entity id"
            />
          </label>
          <label>
            Actor filter
            <input
              value={actorFilter}
              onChange={(event) => setActorFilter(event.target.value)}
              placeholder="Local filter by role or actor id"
            />
          </label>
          <label>
            Limit
            <input value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="numeric" />
          </label>
        </div>
      </section>

      <SavedViewControls
        pageKey="activity"
        currentFilters={{
          fromDate,
          toDate,
          action,
          entityType,
          entityId,
          limit,
          actorFilter,
        }}
        onApplyFilters={applySavedFilters}
        defaultName="Activity view"
      />

      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Entity ID</th>
                <th>Actor</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={6}>No audit activity matched the current filters. Widen the date range or clear one of the filters to see more history.</td>
                </tr>
              ) : (
                filteredEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td>{event.action}</td>
                    <td>{event.entityType}</td>
                    <td><span className="mono-text">{event.entityId}</span></td>
                    <td>{[event.actorRole, event.actorId].filter(Boolean).join(" / ") || "-"}</td>
                    <td><span className="mono-text">{formatJsonPreview(event.metadata)}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
