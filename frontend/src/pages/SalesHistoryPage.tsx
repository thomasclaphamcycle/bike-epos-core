import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useAppConfig } from "../config/appConfig";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { formatCurrencyFromPence } from "../utils/currency";

type SalesHistoryRow = {
  id: string;
  orderNo: string;
  type: "sale";
  status: "draft" | "complete";
  total: number;
  currency: string;
  soldAt: string;
  customer: {
    id: string | null;
    name: string;
  };
  soldBy: {
    id: string | null;
    name: string;
  };
  store: {
    id: string;
    name: string;
  };
  reference: string | null;
  source: "pos" | "workshop" | "online";
};

type SalesHistoryResponse = {
  data: SalesHistoryRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type LocationOption = {
  id: string;
  locationId?: string;
  name: string;
  isDefault?: boolean;
};

type LocationListResponse = {
  locations: LocationOption[];
};

type StatusFilter = "complete" | "draft" | "complete,draft";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeStatusFilter = (value: string | null): StatusFilter => {
  const parts = Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is "draft" | "complete" => item === "draft" || item === "complete"),
    ),
  );

  if (parts.length === 0) {
    return "complete";
  }
  if (parts.length === 2) {
    return "complete,draft";
  }
  return parts[0] === "draft" ? "draft" : "complete";
};

const parsePositiveInteger = (value: string | null, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeDateParam = (value: string | null) => (value && ISO_DATE_ONLY_PATTERN.test(value) ? value : "");

const formatSalesHistoryDate = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    dateStyle: "medium",
  });

const formatSalesHistoryTime = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

const formatReference = (value: string | null) => {
  if (!value) {
    return "-";
  }

  return UUID_PATTERN.test(value) ? value.slice(0, 8).toUpperCase() : value;
};

const formatStatusLabel = (status: SalesHistoryRow["status"]) => (status === "complete" ? "Complete" : "Draft");

const getStatusClassName = (status: SalesHistoryRow["status"]) =>
  status === "complete"
    ? "sales-history-status sales-history-status-complete"
    : "sales-history-status sales-history-status-draft";

const describeSource = (source: SalesHistoryRow["source"]) => {
  if (source === "workshop") {
    return "Workshop sale";
  }
  if (source === "online") {
    return "Online sale";
  }
  return "POS sale";
};

const getStoreFilterId = (location: LocationOption) => location.locationId ?? location.id;

export const SalesHistoryPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const appConfig = useAppConfig();

  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(searchInput, 250);

  const [payload, setPayload] = useState<SalesHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);

  const statusFilter = normalizeStatusFilter(searchParams.get("status"));
  const storeId = searchParams.get("storeId") ?? "";
  const dateFrom = normalizeDateParam(searchParams.get("dateFrom"));
  const dateTo = normalizeDateParam(searchParams.get("dateTo"));
  const page = parsePositiveInteger(searchParams.get("page"), 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(parsePositiveInteger(searchParams.get("pageSize"), 20) as 20 | 50 | 100)
    ? parsePositiveInteger(searchParams.get("pageSize"), 20)
    : 20;

  const applySearchParams = useCallback((mutate: (next: URLSearchParams) => void, replace = true) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const currentSearch = searchParams.get("q") ?? "";
    setSearchInput((existing) => (existing === currentSearch ? existing : currentSearch));
  }, [searchParams]);

  useEffect(() => {
    const nextSearch = debouncedSearch.trim();
    const currentSearch = searchParams.get("q") ?? "";
    if (nextSearch === currentSearch) {
      return;
    }

    applySearchParams((next) => {
      if (nextSearch) {
        next.set("q", nextSearch);
      } else {
        next.delete("q");
      }
      next.set("page", "1");
    });
  }, [applySearchParams, debouncedSearch, searchParams]);

  useEffect(() => {
    let cancelled = false;

    const loadLocations = async () => {
      try {
        const locationPayload = await apiGet<LocationListResponse>("/api/locations");
        if (!cancelled) {
          setLocations(locationPayload.locations ?? []);
        }
      } catch {
        if (!cancelled) {
          setLocations([]);
        }
      }
    };

    void loadLocations();

    return () => {
      cancelled = true;
    };
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) {
      params.set("q", debouncedSearch.trim());
    }
    params.set("status", statusFilter);
    if (storeId) {
      params.set("storeId", storeId);
    }
    if (dateFrom) {
      params.set("dateFrom", dateFrom);
    }
    if (dateTo) {
      params.set("dateTo", dateTo);
    }
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return params.toString();
  }, [dateFrom, dateTo, debouncedSearch, page, pageSize, statusFilter, storeId]);

  const loadSalesHistory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const nextPayload = await apiGet<SalesHistoryResponse>(`/api/sales/history?${queryString}`);
      setPayload(nextPayload);
    } catch (error) {
      setPayload(null);
      setLoadError(error instanceof Error ? error.message : "Failed to load sales history");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadSalesHistory();
  }, [loadSalesHistory]);

  const rows = payload?.data ?? [];
  const pagination = payload?.pagination ?? {
    page,
    pageSize,
    total: 0,
    totalPages: 0,
  };
  const totalPages = Math.max(pagination.totalPages, 1);
  const resultsSummary = payload
    ? `${pagination.total} sale${pagination.total === 1 ? "" : "s"} found`
    : loading
      ? "Loading sales..."
      : "No results yet";

  const clearFilters = () => {
    setSearchInput("");
    setSearchParams(new URLSearchParams({ status: "complete", page: "1", pageSize: String(pageSize) }), {
      replace: true,
    });
  };

  const goToPage = (nextPage: number) => {
    applySearchParams((next) => {
      next.set("page", String(nextPage));
    }, false);
  };

  const openSaleDestination = (saleId: string) => {
    // TODO: Replace this with a dedicated sales-history detail route when CorePOS ships one.
    navigate(`/sales/${encodeURIComponent(saleId)}/receipt/print`);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, saleId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSaleDestination(saleId);
    }
  };

  const formatTotal = (row: SalesHistoryRow) =>
    formatCurrencyFromPence(Math.round(row.total * 100), row.currency || appConfig.store.defaultCurrency);

  return (
    <div className="page-shell">
      <section className="card sales-history-page">
        <div className="card-header-row">
          <div>
            <h1>Sales History</h1>
            <p className="muted-text">
              Practical transaction lookup for completed sales, receipts, workshop-linked checkouts, and back-office review.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={clearFilters} disabled={loading && !payload}>
              Clear filters
            </button>
            <button type="button" onClick={() => void loadSalesHistory()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row sales-history-filter-row">
          <label className="grow">
            Search
            <input
              data-testid="sales-history-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="order no., customer, staff"
            />
          </label>
          <label>
            From
            <input
              data-testid="sales-history-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                const value = event.target.value;
                applySearchParams((next) => {
                  if (value) {
                    next.set("dateFrom", value);
                  } else {
                    next.delete("dateFrom");
                  }
                  next.set("page", "1");
                });
              }}
            />
          </label>
          <label>
            To
            <input
              data-testid="sales-history-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => {
                const value = event.target.value;
                applySearchParams((next) => {
                  if (value) {
                    next.set("dateTo", value);
                  } else {
                    next.delete("dateTo");
                  }
                  next.set("page", "1");
                });
              }}
            />
          </label>
          <label>
            Status
            <select
              data-testid="sales-history-status-filter"
              value={statusFilter}
              onChange={(event) => {
                const value = normalizeStatusFilter(event.target.value);
                applySearchParams((next) => {
                  next.set("status", value);
                  next.set("page", "1");
                });
              }}
            >
              <option value="complete">Completed only</option>
              <option value="draft">Drafts only</option>
              <option value="complete,draft">Completed + drafts</option>
            </select>
          </label>
          <label>
            Store
            <select
              data-testid="sales-history-store-filter"
              value={storeId}
              onChange={(event) => {
                const value = event.target.value;
                applySearchParams((next) => {
                  if (value) {
                    next.set("storeId", value);
                  } else {
                    next.delete("storeId");
                  }
                  next.set("page", "1");
                });
              }}
            >
              <option value="">All stores</option>
              {locations.map((location) => {
                const optionValue = getStoreFilterId(location);
                return (
                  <option key={optionValue} value={optionValue}>
                    {location.name}{location.isDefault ? " (default)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        <div className="sales-history-toolbar">
          <p className="muted-text sales-history-results-summary">{resultsSummary}</p>
          <label className="sales-history-page-size">
            Show
            <select
              data-testid="sales-history-page-size"
              value={String(pageSize)}
              onChange={(event) => {
                const value = PAGE_SIZE_OPTIONS.includes(Number(event.target.value) as 20 | 50 | 100)
                  ? event.target.value
                  : "20";
                applySearchParams((next) => {
                  next.set("pageSize", value);
                  next.set("page", "1");
                });
              }}
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            rows
          </label>
        </div>

        {loadError ? (
          <div className="sales-history-state sales-history-state-error" data-testid="sales-history-error-state">
            <h2>Sales history is unavailable</h2>
            <p className="muted-text">{loadError}</p>
            <button type="button" onClick={() => void loadSalesHistory()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table data-testid="sales-history-table">
                <thead>
                  <tr>
                    <th>Order no.</th>
                    <th>Sold by</th>
                    <th>Customer</th>
                    <th>Reference</th>
                    <th className="sales-history-table__head--numeric">Total</th>
                    <th className="sales-history-table__head--date">Date</th>
                    <th>Store</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} data-testid="sales-history-loading-state">
                        <div className="sales-history-inline-state">
                          <strong>Loading sales...</strong>
                          <span className="table-secondary">Fetching the latest transactions for this view.</span>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {!loading && rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} data-testid="sales-history-empty-state">
                        <div className="sales-history-inline-state">
                          <strong>No sales match the current filters.</strong>
                          <span className="table-secondary">Try widening the date range, changing the store, or clearing the search.</span>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="sales-history-row"
                      data-testid={`sales-history-row-${row.id}`}
                      onClick={() => openSaleDestination(row.id)}
                      onKeyDown={(event) => handleRowKeyDown(event, row.id)}
                      tabIndex={0}
                    >
                      <td>
                        <div className="table-primary mono-text">{row.orderNo}</div>
                        <div className="table-secondary">{describeSource(row.source)}</div>
                      </td>
                      <td>
                        <div className="table-primary">{row.soldBy.name || "-"}</div>
                      </td>
                      <td>
                        <div className="table-primary">{row.customer.name || "Walk-in"}</div>
                      </td>
                      <td>
                        <div className="table-primary mono-text sales-history-reference">{formatReference(row.reference)}</div>
                      </td>
                      <td className="sales-history-total">{formatTotal(row)}</td>
                      <td className="sales-history-date-cell">
                        <div className="table-primary">{formatSalesHistoryDate(row.soldAt)}</div>
                        <div className="table-secondary">{formatSalesHistoryTime(row.soldAt)}</div>
                      </td>
                      <td>
                        <div className="table-primary">{row.store.name || "-"}</div>
                      </td>
                      <td>
                        <span className={getStatusClassName(row.status)}>{formatStatusLabel(row.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sales-history-pagination">
              <p className="muted-text">
                Page {pagination.total === 0 ? 1 : pagination.page} of {totalPages}
                {payload ? ` · ${pagination.total} total` : ""}
              </p>
              <div className="actions-inline">
                <button
                  type="button"
                  onClick={() => goToPage(Math.max(page - 1, 1))}
                  disabled={loading || page <= 1}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(Math.min(page + 1, totalPages))}
                  disabled={loading || pagination.total === 0 || page >= totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
