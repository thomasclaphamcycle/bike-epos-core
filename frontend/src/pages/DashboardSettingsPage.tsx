import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";
import {
  DEFAULT_MANAGEMENT_WIDGET_ORDER,
  defaultManagementWidgetPrefs,
  loadManagementWidgetPrefs,
  ManagementWidgetKey,
  resetManagementWidgetPrefs,
  saveManagementWidgetPrefs,
} from "../utils/dashboardPrefs";

const widgetLabels: Record<ManagementWidgetKey, string> = {
  sales: "Sales Summary",
  workshop: "Workshop Summary",
  inventory: "Lowest Stock Items",
  quickLinks: "Quick Links",
};

export const DashboardSettingsPage = () => {
  const { user } = useAuth();
  const { success } = useToasts();
  const ownerId = user?.id ?? "";
  const [prefs, setPrefs] = useState(defaultManagementWidgetPrefs());

  useEffect(() => {
    setPrefs(loadManagementWidgetPrefs(ownerId));
  }, [ownerId]);

  const orderedKeys = useMemo(
    () => prefs.order.filter((key) => DEFAULT_MANAGEMENT_WIDGET_ORDER.includes(key)),
    [prefs.order],
  );

  const updatePrefs = (next: typeof prefs) => {
    setPrefs(next);
    saveManagementWidgetPrefs(ownerId, next);
  };

  const toggleVisible = (key: ManagementWidgetKey) => {
    updatePrefs({
      ...prefs,
      visible: {
        ...prefs.visible,
        [key]: !prefs.visible[key],
      },
    });
  };

  const move = (key: ManagementWidgetKey, direction: -1 | 1) => {
    const index = orderedKeys.indexOf(key);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= orderedKeys.length) {
      return;
    }
    const nextOrder = [...orderedKeys];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    updatePrefs({
      ...prefs,
      order: nextOrder,
    });
  };

  const reset = () => {
    const next = resetManagementWidgetPrefs(ownerId);
    setPrefs(next);
    success("Dashboard settings reset");
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Dashboard Settings</h1>
            <p className="muted-text">
              Local manager preferences for the management dashboard. This stays browser-local in v1.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={reset}>Reset defaults</button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Widget</th>
                <th>Visible</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {orderedKeys.map((key, index) => (
                <tr key={key}>
                  <td>{widgetLabels[key]}</td>
                  <td>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={prefs.visible[key]}
                        onChange={() => toggleVisible(key)}
                      />
                      Show
                    </label>
                  </td>
                  <td>
                    <div className="actions-inline">
                      <button type="button" onClick={() => move(key, -1)} disabled={index === 0}>Up</button>
                      <button
                        type="button"
                        onClick={() => move(key, 1)}
                        disabled={index === orderedKeys.length - 1}
                      >
                        Down
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
