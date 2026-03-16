import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "./ToastProvider";
import {
  createManagerSavedView,
  getManagerSavedView,
  listManagerSavedViews,
  SavedViewFilters,
  SavedViewPageKey,
} from "../utils/savedViews";

export const SavedViewControls = ({
  pageKey,
  currentFilters,
  onApplyFilters,
  defaultName,
}: {
  pageKey: SavedViewPageKey;
  currentFilters: SavedViewFilters;
  onApplyFilters: (filters: SavedViewFilters) => void;
  defaultName: string;
}) => {
  const { user } = useAuth();
  const { success, error } = useToasts();
  const location = useLocation();
  const navigate = useNavigate();

  const ownerId = user?.id ?? "";
  const [views, setViews] = useState(() => (ownerId ? listManagerSavedViews(ownerId, pageKey) : []));
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState(defaultName);
  const [appliedFromQueryId, setAppliedFromQueryId] = useState<string | null>(null);

  const refreshViews = () => {
    if (!ownerId) {
      setViews([]);
      return;
    }
    const next = listManagerSavedViews(ownerId, pageKey);
    setViews(next);
    if (selectedId && !next.some((view) => view.id === selectedId)) {
      setSelectedId("");
    }
  };

  useEffect(() => {
    refreshViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, pageKey]);

  const queryViewId = useMemo(() => new URLSearchParams(location.search).get("view"), [location.search]);

  useEffect(() => {
    if (!ownerId || !queryViewId || queryViewId === appliedFromQueryId) {
      return;
    }

    const savedView = getManagerSavedView(ownerId, queryViewId);
    if (!savedView || savedView.pageKey !== pageKey) {
      return;
    }

    onApplyFilters(savedView.filters);
    setSelectedId(savedView.id);
    setAppliedFromQueryId(savedView.id);
  }, [appliedFromQueryId, onApplyFilters, ownerId, pageKey, queryViewId]);

  const saveCurrentView = () => {
    if (!ownerId) {
      error("No active user found for saved views.");
      return;
    }

    const created = createManagerSavedView({
      ownerId,
      pageKey,
      name,
      filters: currentFilters,
      route: location.pathname,
    });

    refreshViews();
    setSelectedId(created.id);
    setName(defaultName);
    success("Saved view created.");
  };

  const applySelectedView = () => {
    if (!ownerId || !selectedId) {
      return;
    }

    const savedView = getManagerSavedView(ownerId, selectedId);
    if (!savedView) {
      error("Saved view not found.");
      refreshViews();
      return;
    }

    onApplyFilters(savedView.filters);
    setAppliedFromQueryId(savedView.id);
    navigate(`${location.pathname}?view=${encodeURIComponent(savedView.id)}`, { replace: true });
    success(`Applied saved view: ${savedView.name}`);
  };

  return (
    <section className="card">
      <div className="card-header-row">
        <div>
          <h2>Saved Views</h2>
          <p className="muted-text">Local manager presets for this page only.</p>
        </div>
        <Link to="/management/views">Manage all views</Link>
      </div>
      <div className="filter-row">
        <label className="grow">
          Saved view
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            <option value="">Select saved view</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>{view.name}</option>
            ))}
          </select>
        </label>
        <div className="actions-inline">
          <button type="button" onClick={applySelectedView} disabled={!selectedId}>Apply</button>
        </div>
      </div>
      <div className="filter-row">
        <label className="grow">
          New view name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={defaultName} />
        </label>
        <div className="actions-inline">
          <button type="button" onClick={saveCurrentView}>Save current filters</button>
        </div>
      </div>
    </section>
  );
};
