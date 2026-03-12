import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { toBackendUrl } from "../utils/backendUrl";
import { useAuth } from "../auth/AuthContext";

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

type WorkshopPartsStatus = "OK" | "UNALLOCATED" | "SHORT";

type JobPartRequirement = {
  variantId: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  requiredQty: number;
  allocatedQty: number;
  consumedQty: number;
  returnedQty: number;
  outstandingQty: number;
  availableToAllocate: number;
  missingQty: number;
  stockOnHand: number;
  estimateValuePence: number;
  partsStatus: WorkshopPartsStatus;
};

type PartsOverview = {
  stockLocation: {
    id: string;
    name: string;
    isDefault: boolean;
    source: string;
  };
  requirements: JobPartRequirement[];
  summary: {
    requiredQty: number;
    allocatedQty: number;
    consumedQty: number;
    returnedQty: number;
    outstandingQty: number;
    missingQty: number;
    partsStatus: WorkshopPartsStatus;
  };
};

type WorkshopPartRecord = {
  id: string;
  workshopJobId: string;
  variantId: string;
  stockLocationId: string;
  stockLocationName: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceAtTime: number;
  costPriceAtTime: number | null;
  lineTotalPence: number;
  status: "PLANNED" | "USED" | "RETURNED";
  createdAt: string;
  updatedAt: string;
};

type WorkshopPartsResponse = PartsOverview & {
  workshopJobId: string;
  parts: WorkshopPartRecord[];
  totals: {
    partsUsedTotalPence: number;
    partsPlannedTotalPence: number;
    partsReturnedTotalPence: number;
  };
};

type WorkshopJobResponse = {
  job: {
    id: string;
    status: string;
    rawStatus?: string | null;
    customerId: string | null;
    customerName: string | null;
    bikeDescription: string | null;
    notes: string | null;
    finalizedBasketId: string | null;
    sale: {
      id: string;
      totalPence: number;
      createdAt: string;
    } | null;
    createdAt: string;
    updatedAt: string;
  };
  lines: WorkshopLine[];
  partsOverview: PartsOverview;
};

type WorkshopNote = {
  id: string;
  workshopJobId: string;
  authorStaffId: string | null;
  visibility: "INTERNAL" | "CUSTOMER";
  note: string;
  createdAt: string;
  authorStaff: {
    id: string;
    username: string;
    name: string | null;
  } | null;
};

type WorkshopNotesResponse = {
  notes: WorkshopNote[];
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

type ApprovalState = "pending" | "approved" | "notRequested";

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

const toApprovalState = (status: string): ApprovalState => {
  if (status === "WAITING_FOR_APPROVAL") {
    return "pending";
  }
  if (status === "APPROVED") {
    return "approved";
  }
  return "notRequested";
};

const approvalBadgeClass = (state: ApprovalState) => {
  if (state === "pending") {
    return "status-badge status-warning";
  }
  if (state === "approved") {
    return "status-badge status-info";
  }
  return "status-badge";
};

const approvalLabel = (state: ApprovalState) => {
  if (state === "pending") {
    return "Awaiting Approval";
  }
  if (state === "approved") {
    return "Approved";
  }
  return "Not Requested";
};

const partsStatusClass = (status: WorkshopPartsStatus | undefined) => {
  if (status === "SHORT") {
    return "status-badge status-warning";
  }
  if (status === "UNALLOCATED") {
    return "status-badge";
  }
  return "status-badge status-complete";
};

const toRawStatus = (job: WorkshopJobResponse["job"] | null | undefined) => {
  if (!job) {
    return "";
  }

  if (job.rawStatus) {
    return job.rawStatus;
  }

  switch (job.status) {
    case "BOOKED":
      return "BOOKING_MADE";
    case "READY":
      return "BIKE_READY";
    case "COLLECTED":
    case "CLOSED":
      return "COMPLETED";
    case "IN_PROGRESS":
      return "BIKE_ARRIVED";
    default:
      return job.status;
  }
};

const canPersistApprovalStatus = (status: string) =>
  ["BOOKING_MADE", "BIKE_ARRIVED", "WAITING_FOR_APPROVAL", "APPROVED", "ON_HOLD"].includes(status);

const getStageActions = (status: string): Array<{ label: string; value: string }> => {
  switch (status) {
    case "BOOKING_MADE":
      return [
        { label: "Start Work", value: "IN_PROGRESS" },
        { label: "Cancel", value: "CANCELLED" },
      ];
    case "BIKE_ARRIVED":
    case "APPROVED":
    case "ON_HOLD":
      return [
        { label: "Ready", value: "READY" },
        { label: "Cancel", value: "CANCELLED" },
      ];
    case "WAITING_FOR_APPROVAL":
      return [{ label: "Cancel", value: "CANCELLED" }];
    default:
      return [];
  }
};

export const WorkshopJobPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, error } = useToasts();

  const [payload, setPayload] = useState<WorkshopJobResponse | null>(null);
  const [notes, setNotes] = useState<WorkshopNote[]>([]);
  const [partsPayload, setPartsPayload] = useState<WorkshopPartsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [partsLoading, setPartsLoading] = useState(false);

  const [editableByLineId, setEditableByLineId] = useState<Record<string, EditableLine>>({});

  const [labourDescription, setLabourDescription] = useState("General labour");
  const [labourQty, setLabourQty] = useState(1);
  const [labourPrice, setLabourPrice] = useState(2500);

  const [partSearch, setPartSearch] = useState("");
  const [partQty, setPartQty] = useState(1);
  const [partPrice, setPartPrice] = useState(0);
  const debouncedPartSearch = useDebouncedValue(partSearch, 250);
  const [partResults, setPartResults] = useState<ProductSearchRow[]>([]);

  const [noteDraft, setNoteDraft] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"INTERNAL" | "CUSTOMER">("INTERNAL");
  const [savingNote, setSavingNote] = useState(false);

  const canPostCustomerNotes = isManagerPlus(user?.role);

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

  const loadNotes = async () => {
    if (!id) {
      return;
    }

    setNotesLoading(true);
    try {
      const response = await apiGet<WorkshopNotesResponse>(`/api/workshop/jobs/${encodeURIComponent(id)}/notes`);
      setNotes(response.notes || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop notes";
      error(message);
    } finally {
      setNotesLoading(false);
    }
  };

  const loadParts = async () => {
    if (!id) {
      return;
    }

    setPartsLoading(true);
    try {
      const response = await apiGet<WorkshopPartsResponse>(`/api/workshop-jobs/${encodeURIComponent(id)}/parts`);
      setPartsPayload(response);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop parts";
      error(message);
    } finally {
      setPartsLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadJob(), loadNotes(), loadParts()]);
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

  const updateStageStatus = async (nextStatus: string) => {
    if (!id) {
      return;
    }

    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/status`, { status: nextStatus });
      success("Workflow status updated");
      await loadJob();
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "Failed to update status";
      error(message);
    }
  };

  const updateApprovalStatus = async (nextStatus: "WAITING_FOR_APPROVAL" | "APPROVED") => {
    if (!id) {
      return;
    }

    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/approval`, { status: nextStatus });
      success(nextStatus === "APPROVED" ? "Estimate marked approved" : "Estimate marked awaiting approval");
      await loadJob();
    } catch (approvalError) {
      const message = approvalError instanceof Error ? approvalError.message : "Failed to update approval state";
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
      await Promise.all([loadJob(), loadParts()]);
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
      await Promise.all([loadJob(), loadParts()]);
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
      await Promise.all([loadJob(), loadParts()]);
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
      await Promise.all([loadJob(), loadParts()]);
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "Unable to remove line";
      error(message);
    }
  };

  const addNote = async (event: FormEvent) => {
    event.preventDefault();

    if (!id) {
      return;
    }
    if (!noteDraft.trim()) {
      error("Note text is required.");
      return;
    }
    if (noteVisibility === "CUSTOMER" && !canPostCustomerNotes) {
      error("Customer-visible quote notes require MANAGER+.");
      return;
    }

    setSavingNote(true);
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(id)}/notes`, {
        visibility: noteVisibility,
        note: noteDraft.trim(),
      });
      setNoteDraft("");
      setNoteVisibility("INTERNAL");
      success(noteVisibility === "CUSTOMER" ? "Quote note added" : "Internal note added");
      await loadNotes();
    } catch (noteError) {
      const message = noteError instanceof Error ? noteError.message : "Failed to add note";
      error(message);
    } finally {
      setSavingNote(false);
    }
  };

  const openPosHandoff = async () => {
    if (!id) {
      return;
    }

    if (payload?.job.sale) {
      navigate(`/pos?saleId=${encodeURIComponent(payload.job.sale.id)}`);
      return;
    }

    if (payload?.job.finalizedBasketId) {
      navigate(`/pos?basketId=${encodeURIComponent(payload.job.finalizedBasketId)}`);
      return;
    }

    try {
      const response = await apiPost<{ basket: { id: string } }>(
        `/api/workshop/jobs/${encodeURIComponent(id)}/finalize`,
        {},
      );
      success("Workshop handed off to POS.");
      navigate(`/pos?basketId=${encodeURIComponent(response.basket.id)}`);
    } catch (convertError) {
      const message = convertError instanceof Error ? convertError.message : "Unable to open POS handoff";
      error(message);
    }
  };

  const reserveRequiredParts = async (requirement: JobPartRequirement) => {
    if (!id) {
      return;
    }

    const reserveQty = Math.min(requirement.outstandingQty, requirement.availableToAllocate);
    if (reserveQty <= 0) {
      error("No available stock to reserve for this requirement.");
      return;
    }

    try {
      await apiPost(`/api/workshop-jobs/${encodeURIComponent(id)}/parts`, {
        variantId: requirement.variantId,
        quantity: reserveQty,
        status: "PLANNED",
        note: "Reserved from workshop parts allocation",
      });
      success(`Reserved ${reserveQty} part${reserveQty === 1 ? "" : "s"}.`);
      await Promise.all([loadJob(), loadParts()]);
    } catch (reserveError) {
      const message = reserveError instanceof Error ? reserveError.message : "Unable to reserve parts";
      error(message);
    }
  };

  const markPartStatus = async (partId: string, status: "USED" | "RETURNED") => {
    if (!id) {
      return;
    }

    try {
      await apiPatch(`/api/workshop-jobs/${encodeURIComponent(id)}/parts/${encodeURIComponent(partId)}`, {
        status,
        note: status === "USED" ? "Consumed from workshop job" : "Returned from workshop job",
      });
      success(status === "USED" ? "Part consumed" : "Part returned");
      await Promise.all([loadJob(), loadParts()]);
    } catch (partError) {
      const message = partError instanceof Error ? partError.message : "Unable to update part status";
      error(message);
    }
  };

  const removeReservedPart = async (partId: string) => {
    if (!id) {
      return;
    }

    try {
      await apiDelete(`/api/workshop-jobs/${encodeURIComponent(id)}/parts/${encodeURIComponent(partId)}`, {
        note: "Reservation removed from workshop job",
      });
      success("Reservation removed");
      await Promise.all([loadJob(), loadParts()]);
    } catch (partError) {
      const message = partError instanceof Error ? partError.message : "Unable to remove reservation";
      error(message);
    }
  };

  const labourLines = useMemo(
    () => payload?.lines.filter((line) => line.type === "LABOUR") ?? [],
    [payload],
  );
  const partLines = useMemo(
    () => payload?.lines.filter((line) => line.type === "PART") ?? [],
    [payload],
  );

  const labourSubtotalPence = useMemo(
    () => labourLines.reduce((sum, line) => sum + line.lineTotalPence, 0),
    [labourLines],
  );
  const partsSubtotalPence = useMemo(
    () => partLines.reduce((sum, line) => sum + line.lineTotalPence, 0),
    [partLines],
  );
  const subtotalPence = labourSubtotalPence + partsSubtotalPence;
  const rawStatus = useMemo(() => toRawStatus(payload?.job), [payload?.job]);
  const partsOverview = useMemo<PartsOverview | null>(
    () => partsPayload ?? payload?.partsOverview ?? null,
    [partsPayload, payload?.partsOverview],
  );
  const plannedPartRecords = useMemo(
    () => (partsPayload?.parts ?? []).filter((part) => part.status === "PLANNED"),
    [partsPayload?.parts],
  );
  const usedPartRecords = useMemo(
    () => (partsPayload?.parts ?? []).filter((part) => part.status === "USED"),
    [partsPayload?.parts],
  );

  const approvalState = useMemo(
    () => toApprovalState(rawStatus),
    [rawStatus],
  );

  const customerNotes = useMemo(
    () => notes.filter((note) => note.visibility === "CUSTOMER"),
    [notes],
  );
  const internalNotes = useMemo(
    () => notes.filter((note) => note.visibility === "INTERNAL"),
    [notes],
  );

  if (!id) {
    return <div className="page-shell"><p>Missing workshop job id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <h1>Workshop Job {id.slice(0, 8)}</h1>
          <div className="actions-inline">
            {payload?.job.status !== "CLOSED" && payload?.job.status !== "CANCELLED" ? (
              <button type="button" className="primary" onClick={openPosHandoff}>
                {payload?.job.sale
                  ? "Open sale"
                  : payload?.job.finalizedBasketId
                    ? "Open POS handoff"
                    : "Send to POS"}
              </button>
            ) : null}
            <a
              href={toBackendUrl(`/workshop/${encodeURIComponent(id)}/print`)}
              target="_blank"
              rel="noreferrer"
              className="button-link"
            >
              Print Job
            </a>
          </div>
        </div>

        {loading ? <p>Loading...</p> : null}

        {payload ? (
          <>
            <div className="job-meta-grid">
              <div>
                <strong>Workflow Status:</strong> {payload.job.status}
              </div>
              <div>
                <strong>Approval State:</strong>{" "}
                <span className={approvalBadgeClass(approvalState)}>{approvalLabel(approvalState)}</span>
              </div>
              <div>
                <strong>Raw Status:</strong> {rawStatus || "-"}
              </div>
              <div>
                <strong>Parts State:</strong>{" "}
                <span className={partsStatusClass(partsOverview?.summary.partsStatus)}>
                  {partsOverview?.summary.partsStatus ?? "OK"}
                </span>
              </div>
              <div><strong>Customer:</strong> {payload.job.customerName || "-"}</div>
              <div><strong>Bike:</strong> {payload.job.bikeDescription || "-"}</div>
              <div><strong>Job Notes:</strong> {payload.job.notes || "-"}</div>
              <div><strong>Updated:</strong> {new Date(payload.job.updatedAt).toLocaleString()}</div>
              <div>
                <strong>Parts Location:</strong> {partsOverview?.stockLocation.name ?? "-"}
              </div>
            </div>

            <div className="action-wrap" style={{ marginBottom: "10px" }}>
              {getStageActions(rawStatus).map((action) => (
                <button key={action.value} type="button" onClick={() => void updateStageStatus(action.value)}>
                  {action.label}
                </button>
              ))}
              {canPersistApprovalStatus(rawStatus) ? (
                <>
                  <button
                    type="button"
                    onClick={() => void updateApprovalStatus("WAITING_FOR_APPROVAL")}
                    disabled={approvalState === "pending"}
                  >
                    Request Approval
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateApprovalStatus("APPROVED")}
                    disabled={approvalState === "approved"}
                  >
                    Mark Approved
                  </button>
                </>
              ) : null}
            </div>

            <p className="muted-text">
              Estimate approval is stored using the existing raw workshop job status. This keeps the
              workflow additive, but approval does not live in a separate estimate object in v1.
            </p>

            {rawStatus === "BIKE_READY" ? (
              <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
                Collection is completed through POS checkout. Use the POS handoff button above instead of
                manually marking the job collected.
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Estimate</h2>
            <p className="muted-text">Existing labour and part lines are used as the live estimate contents.</p>
          </div>
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">Labour Lines</span>
            <strong className="metric-value">{labourLines.length}</strong>
            <span className="table-secondary">{formatMoney(labourSubtotalPence)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Part Lines</span>
            <strong className="metric-value">{partLines.length}</strong>
            <span className="table-secondary">{formatMoney(partsSubtotalPence)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Quote Notes</span>
            <strong className="metric-value">{customerNotes.length}</strong>
            <span className="table-secondary">Customer-visible notes</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Estimate Total</span>
            <strong className="metric-value">{formatMoney(subtotalPence)}</strong>
            <span className="table-secondary">Auto-refreshes with line changes</span>
          </div>
        </div>

        {payload && payload.lines.length === 0 ? (
          <div className="restricted-panel">
            Add labour and part lines below to create the first estimate for this job.
          </div>
        ) : null}

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
              {!payload || payload.lines.length === 0 ? (
                <tr>
                  <td colSpan={6}>No estimate lines yet.</td>
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
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Parts Allocation</h2>
            <p className="muted-text">
              Reserve parts against estimate lines, then consume them when they are fitted.
            </p>
          </div>
          <div className="table-secondary">
            {partsLoading ? "Refreshing parts..." : partsOverview?.stockLocation.name ?? "-"}
          </div>
        </div>

        {partsOverview ? (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <span className="metric-label">Required</span>
                <strong className="metric-value">{partsOverview.summary.requiredQty}</strong>
                <span className="table-secondary">Estimate part quantity</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Allocated</span>
                <strong className="metric-value">{partsOverview.summary.allocatedQty}</strong>
                <span className="table-secondary">{plannedPartRecords.length} planned records</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Consumed</span>
                <strong className="metric-value">{partsOverview.summary.consumedQty}</strong>
                <span className="table-secondary">{usedPartRecords.length} used records</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Parts Status</span>
                <strong className="metric-value">
                  <span className={partsStatusClass(partsOverview.summary.partsStatus)}>
                    {partsOverview.summary.partsStatus}
                  </span>
                </strong>
                <span className="table-secondary">
                  Missing {partsOverview.summary.missingQty}, outstanding {partsOverview.summary.outstandingQty}
                </span>
              </div>
            </div>

            {partsOverview.summary.partsStatus === "SHORT" ? (
              <div className="restricted-panel warning-panel">
                Parts are short for this job. The workshop board will surface this job in the Waiting Parts bucket,
                even if the raw workshop status has not been manually changed.
              </div>
            ) : partsOverview.summary.partsStatus === "UNALLOCATED" ? (
              <div className="restricted-panel info-panel">
                Parts are still unallocated for this job, but current stock suggests they can be reserved now.
              </div>
            ) : (
              <div className="success-panel">Required workshop parts are fully allocated or consumed.</div>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Part Requirement</th>
                    <th>Required</th>
                    <th>Allocated</th>
                    <th>Consumed</th>
                    <th>Outstanding</th>
                    <th>Missing</th>
                    <th>On Hand</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {partsOverview.requirements.length === 0 ? (
                    <tr>
                      <td colSpan={8}>No part estimate lines yet.</td>
                    </tr>
                  ) : (
                    partsOverview.requirements.map((requirement) => {
                      const reserveQty = Math.min(
                        requirement.outstandingQty,
                        requirement.availableToAllocate,
                      );

                      return (
                        <tr key={requirement.variantId}>
                          <td>
                            <strong>{requirement.productName}</strong>
                            <div className="table-secondary">
                              {requirement.variantName || requirement.sku} · {requirement.sku}
                            </div>
                          </td>
                          <td>{requirement.requiredQty}</td>
                          <td>{requirement.allocatedQty}</td>
                          <td>{requirement.consumedQty}</td>
                          <td>{requirement.outstandingQty}</td>
                          <td>
                            <span className={partsStatusClass(requirement.partsStatus)}>
                              {requirement.missingQty}
                            </span>
                          </td>
                          <td>{requirement.stockOnHand}</td>
                          <td>
                            {reserveQty > 0 ? (
                              <button type="button" onClick={() => void reserveRequiredParts(requirement)}>
                                Reserve {reserveQty}
                              </button>
                            ) : (
                              <span className="muted-text">
                                {requirement.partsStatus === "SHORT" ? "No stock to reserve" : "Covered"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Allocated Record</th>
                    <th>Status</th>
                    <th>Qty</th>
                    <th>Location</th>
                    <th>Value</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {!partsPayload || partsPayload.parts.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No workshop part allocations yet.</td>
                    </tr>
                  ) : (
                    partsPayload.parts.map((part) => (
                      <tr key={part.id}>
                        <td>
                          <strong>{part.productName}</strong>
                          <div className="table-secondary">
                            {part.variantName || part.sku} · {part.sku}
                          </div>
                        </td>
                        <td>
                          <span className={part.status === "USED" ? "status-badge status-complete" : part.status === "PLANNED" ? "status-badge" : "status-badge status-info"}>
                            {part.status}
                          </span>
                        </td>
                        <td>{part.quantity}</td>
                        <td>{part.stockLocationName}</td>
                        <td>{formatMoney(part.lineTotalPence)}</td>
                        <td>
                          <div className="actions-inline">
                            {part.status === "PLANNED" ? (
                              <>
                                <button type="button" onClick={() => void markPartStatus(part.id, "USED")}>
                                  Consume
                                </button>
                                <button type="button" onClick={() => void removeReservedPart(part.id)}>
                                  Unreserve
                                </button>
                              </>
                            ) : null}
                            {part.status === "USED" ? (
                              <button type="button" onClick={() => void markPartStatus(part.id, "RETURNED")}>
                                Return
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Loading parts allocation...</p>
        )}
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Quote & Notes</h2>
            <p className="muted-text">
              Use internal notes for staff context. Use customer-visible notes for quote or approval messaging.
            </p>
          </div>
        </div>

        <form className="note-form-grid" onSubmit={addNote}>
          <label className="note-form-wide">
            Note
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Add internal note or customer-visible quote note"
            />
          </label>
          <label>
            Visibility
            <select
              value={noteVisibility}
              onChange={(event) => setNoteVisibility(event.target.value as "INTERNAL" | "CUSTOMER")}
            >
              <option value="INTERNAL">Internal</option>
              {canPostCustomerNotes ? <option value="CUSTOMER">Customer-visible</option> : null}
            </select>
          </label>
          <div className="actions-inline">
            <button type="submit" className="primary" disabled={savingNote}>
              {savingNote ? "Saving..." : "Add Note"}
            </button>
          </div>
        </form>

        {!canPostCustomerNotes ? (
          <p className="muted-text">Customer-visible quote notes require MANAGER+.</p>
        ) : null}

        <div className="notes-grid">
          <section className="notes-panel">
            <h3>Customer-visible Notes</h3>
            {notesLoading ? <p>Loading notes...</p> : null}
            {customerNotes.length === 0 ? (
              <p className="muted-text">No customer-visible quote notes yet.</p>
            ) : (
              customerNotes.map((note) => (
                <article key={note.id} className="note-card">
                  <div className="note-card-header">
                    <span className="status-badge status-info">{note.visibility}</span>
                    <span className="table-secondary">{new Date(note.createdAt).toLocaleString()}</span>
                  </div>
                  <p>{note.note}</p>
                  <div className="table-secondary">
                    {note.authorStaff?.name || note.authorStaff?.username || "Unknown staff"}
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="notes-panel">
            <h3>Internal Notes</h3>
            {notesLoading ? <p>Loading notes...</p> : null}
            {internalNotes.length === 0 ? (
              <p className="muted-text">No internal notes yet.</p>
            ) : (
              internalNotes.map((note) => (
                <article key={note.id} className="note-card">
                  <div className="note-card-header">
                    <span className="status-badge">{note.visibility}</span>
                    <span className="table-secondary">{new Date(note.createdAt).toLocaleString()}</span>
                  </div>
                  <p>{note.note}</p>
                  <div className="table-secondary">
                    {note.authorStaff?.name || note.authorStaff?.username || "Unknown staff"}
                  </div>
                </article>
              ))
            )}
          </section>
        </div>
      </section>

      <section className="card">
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
      </section>
    </div>
  );
};
