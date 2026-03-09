import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";
import {
  deleteManagerSavedView,
  listManagerSavedViews,
  ManagerSavedView,
  renameManagerSavedView,
} from "../utils/savedViews";

export const SavedViewsPage = () => {
  const { user } = useAuth();
  const { success, error } = useToasts();
  const [views, setViews] = useState<ManagerSavedView[]>([]);
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});

  const ownerId = user?.id ?? "";

  const refreshViews = () => {
    if (!ownerId) {
      setViews([]);
      return;
    }

    const next = listManagerSavedViews(ownerId);
    setViews(next);
    setNameEdits(Object.fromEntries(next.map((view) => [view.id, view.name])));
  };

  useEffect(() => {
    refreshViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const groupedViews = useMemo(() => {
    const groups = new Map<string, ManagerSavedView[]>();
    for (const view of views) {
      const existing = groups.get(view.pageLabel) ?? [];
      existing.push(view);
      groups.set(view.pageLabel, existing);
    }
    return Array.from(groups.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  }, [views]);

  const renameView = (viewId: string) => {
    if (!ownerId) {
      return;
    }
    const next = renameManagerSavedView(ownerId, viewId, nameEdits[viewId] ?? "");
    if (!next) {
      error("Saved view name cannot be empty.");
      return;
    }
    refreshViews();
    success("Saved view renamed.");
  };

  const deleteView = (viewId: string) => {
    if (!ownerId) {
      return;
    }
    deleteManagerSavedView(ownerId, viewId);
    refreshViews();
    success("Saved view deleted.");
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Saved Views</h1>
            <p className="muted-text">
              Local manager filter presets for management pages. This first version uses browser-local persistence per signed-in user.
            </p>
          </div>
          <Link to="/management">Back to management</Link>
        </div>
      </section>

      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Name</th>
                <th>Filters</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {views.length === 0 ? (
                <tr>
                  <td colSpan={5}>No saved views yet.</td>
                </tr>
              ) : groupedViews.flatMap(([pageLabel, pageViews]) => pageViews.map((view, index) => (
                <tr key={view.id}>
                  <td>{index === 0 ? pageLabel : ""}</td>
                  <td>
                    <input
                      value={nameEdits[view.id] ?? ""}
                      onChange={(event) => setNameEdits((current) => ({ ...current, [view.id]: event.target.value }))}
                    />
                  </td>
                  <td><span className="mono-text">{JSON.stringify(view.filters)}</span></td>
                  <td>{new Date(view.updatedAt).toLocaleString()}</td>
                  <td>
                    <div className="actions-inline">
                      <button type="button" onClick={() => renameView(view.id)}>Rename</button>
                      <Link className="button-link" to={`${view.route}?view=${encodeURIComponent(view.id)}`}>Open</Link>
                      <button type="button" onClick={() => deleteView(view.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))) }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
