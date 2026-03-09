export type SavedViewPageKey =
  | "sales"
  | "workshop"
  | "reordering"
  | "activity"
  | "purchasing";

export type SavedViewFilters = Record<string, string>;

export type ManagerSavedView = {
  id: string;
  ownerId: string;
  pageKey: SavedViewPageKey;
  pageLabel: string;
  route: string;
  name: string;
  filters: SavedViewFilters;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "corepos.managerSavedViews";

export const SAVED_VIEW_PAGE_META: Record<SavedViewPageKey, { label: string; route: string }> = {
  sales: { label: "Sales Analytics", route: "/management/sales" },
  workshop: { label: "Workshop Metrics", route: "/management/workshop" },
  reordering: { label: "Reorder Suggestions", route: "/management/reordering" },
  activity: { label: "Audit & Activity", route: "/management/activity" },
  purchasing: { label: "Purchase Order Action Centre", route: "/management/purchasing" },
};

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const readAll = (): ManagerSavedView[] => {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeAll = (views: ManagerSavedView[]) => {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
};

export const listManagerSavedViews = (ownerId: string, pageKey?: SavedViewPageKey) =>
  readAll()
    .filter((view) => view.ownerId === ownerId)
    .filter((view) => (pageKey ? view.pageKey === pageKey : true))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const getManagerSavedView = (ownerId: string, id: string) =>
  readAll().find((view) => view.ownerId === ownerId && view.id === id) ?? null;

export const createManagerSavedView = (input: {
  ownerId: string;
  pageKey: SavedViewPageKey;
  name: string;
  filters: SavedViewFilters;
  route?: string;
}) => {
  const now = new Date().toISOString();
  const pageMeta = SAVED_VIEW_PAGE_META[input.pageKey];
  const next: ManagerSavedView = {
    id: `view_${Math.random().toString(36).slice(2, 10)}`,
    ownerId: input.ownerId,
    pageKey: input.pageKey,
    pageLabel: pageMeta.label,
    route: input.route ?? pageMeta.route,
    name: input.name.trim() || `${pageMeta.label} View`,
    filters: input.filters,
    createdAt: now,
    updatedAt: now,
  };

  const views = [next, ...readAll()];
  writeAll(views);
  return next;
};

export const renameManagerSavedView = (ownerId: string, id: string, name: string) => {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  let updated: ManagerSavedView | null = null;
  const views = readAll().map((view) => {
    if (view.ownerId !== ownerId || view.id !== id) {
      return view;
    }
    updated = {
      ...view,
      name: trimmed,
      updatedAt: new Date().toISOString(),
    };
    return updated;
  });

  writeAll(views);
  return updated;
};

export const deleteManagerSavedView = (ownerId: string, id: string) => {
  const views = readAll().filter((view) => !(view.ownerId === ownerId && view.id === id));
  writeAll(views);
};
