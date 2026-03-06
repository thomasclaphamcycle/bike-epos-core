import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { toBackendUrl } from "../utils/backendUrl";

type WorkshopLine = {
  id: string;
  type: "LABOUR" | "PART";
  productId: string | null;
  productName: string | null;
  variantId: string | null;
  variantSku: string | null;
  variantName: string | null;
  description: string;
  qty: number;
  unitPricePence: number;
  lineTotalPence: number;
};

type WorkshopJobResponse = {
  job: {
    id: string;
    status: string;
    customerId: string | null;
    customerName: string | null;
    bikeDescription: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  };
  lines: WorkshopLine[];
};

type ProductSearchRow = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  pricePence: number;
};

type EditableLine = {
  description: string;
  qty: number;
  unitPricePence: number;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const statusButtonActions: Array<{ label: string; value: string }> = [
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Awaiting Parts", value: "WAITING_FOR_PARTS" },
  { label: "Ready", value: "READY" },
  { label: "Collected", value: "COMPLETED" },
  { label: "Cancelled", value: "CANCELLED" },
];

const toStatusBadgeClass = (status: string) => {
  if (status === "CANCELLED") return "status-badge status-cancelled";
  if (status === "COMPLETED") return "status-badge status-complete";
  if (status === "BIKE_READY" || status === "READY") return "status-badge status-ready";
  if (status === "WAITING_FOR_PARTS") return "status-badge status-warning";
  return "status-badge";
};

export const WorkshopJobPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success, error } = useToasts();

  const [payload, setPayload] = useState<WorkshopJobResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const [editableByLineId, setEditableByLineId] = useState<Record<string, EditableLine>>({});

  const [labourDescription, setLabourDescription] = useState("General labour");
  const [labourQty, setLabourQty] = useState(1);
  const [labourPrice, setLabourPrice] = useState(2500);

  const [partSearch, setPartSearch] = useState("");
  const [partQty, setPartQty] = useState(1);
  const [partPrice, setPartPrice] = useState(0);
  const debouncedPartSearch = useDebouncedValue(partSearch, 250);
  const [partResults, setPartResults] = useState<ProductSearchRow[]>([]);

  const subtotalPence = useMemo(
    () => payload?.lines.reduce((sum, line) => sum + line.lineTotalPence, 0) ?? 0,
    [payload],
  );

  const loadJob = async () => {
    if (!id) {
      return;
    }

    setLoading(true);
    try {
      const response = await apiGet<WorkshopJobResponse>(`/api/workshop/jobs/${encodeURIComponent(id)}`);
      setPayload(response);
      setEditableByLineId(
        Object.fromEntries(
          response.lines.map((line) => [
            line.id,
            {
              description: line.description,
              qty: line.qty,
              unitPricePence: line.unitPricePence,
            },
          ]),
        ),
      );
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop job";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!debouncedPartSearch.trim()) {
      setPartResults([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const results = await apiGet<{ rows: ProductSearchRow[] }>(
          `/api/products/search?q=${encodeURIComponent(debouncedPartSearch.trim())}`,
        );
        if (!cancelled) {
          setPartResults(Array.isArray(results.rows) ? results.rows : []);
        }
      } catch (searchError) {
        if (!cancelled) {
          const message = searchError instanceof Error ? searchError.message : "Product search failed";
          error(message);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [debouncedPartSearch, error]);

  const updateStatus = async (nextStatus: string) => {
    if (!id) {
      return;
    }
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/status`, { status: nextStatus });
      success("Status updated");
      await loadJob();
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "Failed to update status";
      error(message);
    }
  };

  const addLabourLine = async () => {
    if (!id) {
      return;
    }
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/lines`, {
        type: "LABOUR",
        description: labourDescription,
        qty: labourQty,
        unitPricePence: labourPrice,
      });
      success("Labour line added");
      await loadJob();
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Unable to add labour line";
      error(message);
    }
  };

  const addPartLine = async (product: ProductSearchRow) => {
    if (!id) {
      return;
    }
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/lines`, {
        type: "PART",
        productId: product.productId,
        variantId: product.id,
        description: product.name,
        qty: partQty,
        unitPricePence: partPrice > 0 ? partPrice : product.pricePence,
      });
      success("Part line added");
      setPartSearch("");
      setPartResults([]);
      await loadJob();
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Unable to add part line";
      error(message);
    }
  };

  const saveLine = async (lineId: string) => {
    if (!id) {
      return;
    }

    const editable = editableByLineId[lineId];
    if (!editable) {
      return;
    }

    try {
      await apiPatch(`/api/workshop/jobs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`, {
        description: editable.description,
        qty: editable.qty,
        unitPricePence: editable.unitPricePence,
      });
      success("Line updated");
      await loadJob();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save line";
      error(message);
    }
  };

  const removeLine = async (lineId: string) => {
    if (!id) {
      return;
    }

    try {
      await apiDelete(`/api/workshop/jobs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`);
      success("Line removed");
      await loadJob();
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "Unable to remove line";
      error(message);
    }
  };

  const convertToSale = async () => {
    if (!id) {
      return;
    }

    try {
      const response = await apiPost<{ basket: { id: string } }>(
        `/api/workshop/jobs/${encodeURIComponent(id)}/finalize`,
        {},
      );
      const basketId = response.basket.id;
      success("Workshop job converted. Opening POS.");
      navigate(`/pos?basketId=${encodeURIComponent(basketId)}`);
    } catch (convertError) {
      const message = convertError instanceof Error ? convertError.message : "Unable to convert job";
      error(message);
    }
  };

  if (!id) {
    return <div className="page-shell"><p>Missing workshop job id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <h1>Workshop Job {id.slice(0, 8)}</h1>
          <div className="actions-inline action-callout">
            <button type="button" className="primary" onClick={convertToSale}>
              Convert to Sale
            </button>
            <a href={toBackendUrl(`/workshop/${encodeURIComponent(id)}/print`)} target="_blank" rel="noreferrer" className="button-link">
              Print Job
            </a>
          </div>
        </div>

        {loading ? <p>Loading...</p> : null}

        {payload ? (
          <>
            <div className="job-meta-grid">
              <div>
                <strong>Status:</strong>{" "}
                <span className={toStatusBadgeClass(payload.job.status)}>{payload.job.status}</span>
              </div>
              <div><strong>Customer:</strong> {payload.job.customerName || "-"}</div>
              <div><strong>Bike:</strong> {payload.job.bikeDescription || "-"}</div>
              <div><strong>Notes:</strong> {payload.job.notes || "-"}</div>
            </div>

            <div className="action-wrap" style={{ marginBottom: "10px" }}>
              {statusButtonActions.map((action) => (
                <button key={action.value} type="button" onClick={() => void updateStatus(action.value)}>
                  {action.label}
                </button>
              ))}
            </div>

            <h2>Lines</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payload.lines.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No lines yet.</td>
                    </tr>
                  ) : (
                    payload.lines.map((line) => {
                      const editable = editableByLineId[line.id] ?? {
                        description: line.description,
                        qty: line.qty,
                        unitPricePence: line.unitPricePence,
                      };

                      return (
                        <tr key={line.id}>
                          <td>{line.type}</td>
                          <td>
                            <input
                              value={editable.description}
                              onChange={(event) =>
                                setEditableByLineId((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...editable,
                                    description: event.target.value,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={1}
                              value={editable.qty}
                              onChange={(event) =>
                                setEditableByLineId((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...editable,
                                    qty: Number(event.target.value) || 1,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={editable.unitPricePence}
                              onChange={(event) =>
                                setEditableByLineId((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...editable,
                                    unitPricePence: Number(event.target.value) || 0,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td>{formatMoney((editable.qty || 0) * (editable.unitPricePence || 0))}</td>
                          <td>
                            <div className="actions-inline">
                              <button type="button" onClick={() => void saveLine(line.id)}>Save</button>
                              <button type="button" onClick={() => void removeLine(line.id)}>Remove</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="totals-row">
              <strong>Subtotal:</strong> {formatMoney(subtotalPence)}
            </div>

            <h2>Add Labour</h2>
            <div className="filter-row">
              <label className="grow">
                Description
                <input
                  value={labourDescription}
                  onChange={(event) => setLabourDescription(event.target.value)}
                />
              </label>
              <label>
                Qty
                <input
                  type="number"
                  min={1}
                  value={labourQty}
                  onChange={(event) => setLabourQty(Number(event.target.value) || 1)}
                />
              </label>
              <label>
                Unit (p)
                <input
                  type="number"
                  min={0}
                  value={labourPrice}
                  onChange={(event) => setLabourPrice(Number(event.target.value) || 0)}
                />
              </label>
              <button type="button" onClick={addLabourLine}>Add Labour</button>
            </div>

            <h2>Add Part</h2>
            <div className="filter-row">
              <label className="grow">
                Search Product
                <input
                  value={partSearch}
                  onChange={(event) => setPartSearch(event.target.value)}
                  placeholder="name / barcode / sku"
                />
              </label>
              <label>
                Qty
                <input
                  type="number"
                  min={1}
                  value={partQty}
                  onChange={(event) => setPartQty(Number(event.target.value) || 1)}
                />
              </label>
              <label>
                Unit (p)
                <input
                  type="number"
                  min={0}
                  value={partPrice}
                  onChange={(event) => setPartPrice(Number(event.target.value) || 0)}
                />
              </label>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>SKU</th>
                    <th>Price</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {partResults.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No part results.</td>
                    </tr>
                  ) : (
                    partResults.map((product) => (
                      <tr key={product.id}>
                        <td>{product.name}</td>
                        <td>{product.sku}</td>
                        <td>{formatMoney(product.pricePence)}</td>
                        <td>
                          <button type="button" onClick={() => void addPartLine(product)}>
                            Add Part
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
};
