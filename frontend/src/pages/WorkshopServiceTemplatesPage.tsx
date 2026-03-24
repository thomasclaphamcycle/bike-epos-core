import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import {
  type WorkshopServiceTemplate,
  type WorkshopServiceTemplatesResponse,
  formatWorkshopTemplateMoney,
} from "../features/workshop/serviceTemplates";

const DEFAULT_LABOUR_DESCRIPTION = "General labour";
const DEFAULT_LABOUR_QTY = 1;
const DEFAULT_LABOUR_PRICE = "25.00";
const DEFAULT_PART_QTY = 1;

type ProductSearchRow = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  pricePence: number;
};

type TemplateDraftLine = {
  id: string;
  type: "LABOUR" | "PART";
  productId: string | null;
  productName: string | null;
  variantId: string | null;
  variantSku: string | null;
  description: string;
  qty: number;
  unitPricePence: string;
  isOptional: boolean;
};

type TemplateDraft = {
  id: string | null;
  name: string;
  description: string;
  category: string;
  defaultDurationMinutes: string;
  pricingMode: "STANDARD_SERVICE" | "FIXED_PRICE_SERVICE";
  targetTotalPrice: string;
  isActive: boolean;
  lines: TemplateDraftLine[];
};

const penceToPoundsInput = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return "";
  }
  return (value / 100).toFixed(2);
};

const poundsInputToPence = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
};

const emptyDraft = (): TemplateDraft => ({
  id: null,
  name: "",
  description: "",
  category: "",
  defaultDurationMinutes: "",
  pricingMode: "STANDARD_SERVICE",
  targetTotalPrice: "",
  isActive: true,
  lines: [],
});

const draftLineId = () => `draft-${Math.random().toString(36).slice(2, 10)}`;

const normalizeDraftLinkValue = (value: string | null) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getDraftLineValidationMessage = (line: TemplateDraftLine) => {
  if (!line.description.trim()) {
    return `${line.type} lines need a description.`;
  }

  if (!Number.isInteger(line.qty) || line.qty <= 0) {
    return `${line.type} line quantity must be at least 1.`;
  }

  const productId = normalizeDraftLinkValue(line.productId);
  const variantId = normalizeDraftLinkValue(line.variantId);
  const unitPricePence = poundsInputToPence(line.unitPricePence);

  if (line.type === "LABOUR") {
    if (productId || variantId) {
      return "Labour lines cannot link inventory items.";
    }

    if (unitPricePence === null) {
      return "Labour lines need a valid unit price in pounds.";
    }

    return null;
  }

  if (Boolean(productId) !== Boolean(variantId)) {
    return "Part lines must keep product and variant links together.";
  }

  if (line.unitPricePence.trim() && unitPricePence === null) {
    return "Part unit price must be valid pounds or left blank to use the product price.";
  }

  return null;
};

const toDraft = (template: WorkshopServiceTemplate): TemplateDraft => ({
  id: template.id,
  name: template.name,
  description: template.description ?? "",
  category: template.category ?? "",
  defaultDurationMinutes: template.defaultDurationMinutes ? `${template.defaultDurationMinutes}` : "",
  pricingMode: template.pricingMode,
  targetTotalPrice: penceToPoundsInput(template.targetTotalPricePence),
  isActive: template.isActive,
  lines: template.lines.map((line) => ({
    id: line.id,
    type: line.type,
    productId: line.productId,
    productName: line.productName,
    variantId: line.variantId,
    variantSku: line.variantSku,
    description: line.description,
    qty: line.qty,
    unitPricePence: penceToPoundsInput(line.unitPricePence),
    isOptional: line.isOptional,
  })),
});

export const WorkshopServiceTemplatesPage = () => {
  const { success, error } = useToasts();
  const [templates, setTemplates] = useState<WorkshopServiceTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [partSearch, setPartSearch] = useState("");
  const [partQty, setPartQty] = useState(DEFAULT_PART_QTY);
  const [partPrice, setPartPrice] = useState("");
  const [partOptional, setPartOptional] = useState(true);
  const debouncedPartSearch = useDebouncedValue(partSearch, 250);
  const [partResults, setPartResults] = useState<ProductSearchRow[]>([]);
  const [labourDescription, setLabourDescription] = useState(DEFAULT_LABOUR_DESCRIPTION);
  const [labourQty, setLabourQty] = useState(DEFAULT_LABOUR_QTY);
  const [labourPrice, setLabourPrice] = useState(DEFAULT_LABOUR_PRICE);

  const resetPendingLineInputs = () => {
    setPartSearch("");
    setPartQty(DEFAULT_PART_QTY);
    setPartPrice("");
    setPartOptional(true);
    setPartResults([]);
    setLabourDescription(DEFAULT_LABOUR_DESCRIPTION);
    setLabourQty(DEFAULT_LABOUR_QTY);
    setLabourPrice(DEFAULT_LABOUR_PRICE);
  };

  const resetEditor = () => {
    setRefreshNotice(null);
    setDraft(emptyDraft());
    resetPendingLineInputs();
  };

  const loadTemplates = async (options?: { backgroundFailureMessage?: string }) => {
    setLoading(true);
    try {
      const response = await apiGet<WorkshopServiceTemplatesResponse>(
        "/api/workshop/service-templates?includeInactive=true",
      );
      setTemplates(response.templates || []);
      setRefreshNotice(null);
    } catch (loadError) {
      const message = options?.backgroundFailureMessage
        ?? (loadError instanceof Error ? loadError.message : "Failed to load workshop templates");
      setRefreshNotice(message);
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          error(searchError instanceof Error ? searchError.message : "Product search failed");
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [debouncedPartSearch, error]);

  const totalPence = useMemo(
    () =>
      draft.lines.reduce((sum, line) => {
        const unitPrice = poundsInputToPence(line.unitPricePence) ?? 0;
        return sum + (line.qty * unitPrice);
      }, 0),
    [draft.lines],
  );

  const labourLineCount = useMemo(
    () => draft.lines.filter((line) => line.type === "LABOUR").length,
    [draft.lines],
  );

  const draftLineMessages = useMemo(
    () => draft.lines.map((line) => ({ id: line.id, message: getDraftLineValidationMessage(line) })),
    [draft.lines],
  );

  const invalidDraftLineMessages = draftLineMessages
    .map((entry) => entry.message)
    .filter((entry): entry is string => Boolean(entry));

  const labourBuilderMessage = useMemo(() => {
    if (!labourDescription.trim()) {
      return "Add a labour description, then click Add Labour to place it into Template Lines.";
    }

    if (!Number.isInteger(labourQty) || labourQty <= 0) {
      return "Labour quantity must be at least 1.";
    }

    if (poundsInputToPence(labourPrice) === null) {
      return "Enter a valid labour unit price in pounds.";
    }

    if (draft.pricingMode === "FIXED_PRICE_SERVICE" && labourLineCount >= 1) {
      return "Fixed price services can only include one labour line.";
    }

    return null;
  }, [draft.pricingMode, labourDescription, labourLineCount, labourPrice, labourQty]);

  const partBuilderMessage = useMemo(() => {
    if (!Number.isInteger(partQty) || partQty <= 0) {
      return "Part quantity must be at least 1.";
    }

    if (partPrice.trim() && poundsInputToPence(partPrice) === null) {
      return "Enter a valid part price in pounds or leave it blank to use the product price.";
    }

    return null;
  }, [partPrice, partQty]);

  const templateValidationMessages = useMemo(() => {
    const messages: string[] = [];

    if (!draft.name.trim()) {
      messages.push("Template name is required.");
    }

    if (
      draft.defaultDurationMinutes.trim()
      && (!Number.isInteger(Number(draft.defaultDurationMinutes)) || Number(draft.defaultDurationMinutes) <= 0)
    ) {
      messages.push("Default duration must be a positive whole number of minutes.");
    }

    if (draft.pricingMode === "FIXED_PRICE_SERVICE") {
      if (!draft.targetTotalPrice.trim()) {
        messages.push("Fixed price services need a target total price.");
      } else if (poundsInputToPence(draft.targetTotalPrice) === null) {
        messages.push("Target total price must be a valid pound value.");
      }

      if (labourLineCount === 0) {
        messages.push("Fixed price services need one labour line so labour can rebalance to the target.");
      }

      if (labourLineCount > 1) {
        messages.push("Fixed price services can only have one labour line.");
      }
    }

    if (draft.lines.length === 0) {
      messages.push("Add at least one template line before saving.");
    }

    messages.push(...invalidDraftLineMessages);
    return Array.from(new Set(messages));
  }, [
    draft.defaultDurationMinutes,
    draft.lines.length,
    draft.name,
    draft.pricingMode,
    draft.targetTotalPrice,
    invalidDraftLineMessages,
    labourLineCount,
  ]);

  const canSaveTemplate = templateValidationMessages.length === 0 && !saving && !deleting;

  const upsertTemplate = (template: WorkshopServiceTemplate) => {
    setTemplates((current) => {
      const withoutCurrent = current.filter((entry) => entry.id !== template.id);
      return [template, ...withoutCurrent].sort((left, right) => left.name.localeCompare(right.name));
    });
  };

  const selectTemplate = (template: WorkshopServiceTemplate) => {
    setDraft(toDraft(template));
    resetPendingLineInputs();
    setRefreshNotice(null);
  };

  const saveTemplate = async () => {
    if (templateValidationMessages.length > 0) {
      error(templateValidationMessages[0]);
      return;
    }

    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      category: draft.category.trim() || null,
      defaultDurationMinutes: draft.defaultDurationMinutes.trim()
        ? Number(draft.defaultDurationMinutes)
        : null,
      pricingMode: draft.pricingMode,
      targetTotalPricePence:
        draft.pricingMode === "FIXED_PRICE_SERVICE"
          ? poundsInputToPence(draft.targetTotalPrice)
          : null,
      isActive: draft.isActive,
      lines: draft.lines.map((line, index) => ({
        type: line.type,
        ...(line.type === "PART"
          ? {
              productId: normalizeDraftLinkValue(line.productId),
              variantId: normalizeDraftLinkValue(line.variantId),
            }
          : {}),
        description: line.description.trim(),
        qty: line.qty,
        unitPricePence: poundsInputToPence(line.unitPricePence),
        isOptional: line.type === "PART" ? line.isOptional : false,
        sortOrder: index,
      })),
    };

    setSaving(true);
    try {
      if (draft.id) {
        const response = await apiPatch<{ template: WorkshopServiceTemplate }>(
          `/api/workshop/service-templates/${encodeURIComponent(draft.id)}`,
          payload,
        );
        upsertTemplate(response.template);
        success("Workshop service template updated");
      } else {
        const response = await apiPost<{ template: WorkshopServiceTemplate }>(
          "/api/workshop/service-templates",
          payload,
        );
        upsertTemplate(response.template);
        success("Workshop service template created");
      }
      setRefreshNotice(null);
      resetEditor();
      void loadTemplates({
        backgroundFailureMessage:
          "Template saved, but the template list could not refresh. Refresh the page to confirm the latest data.",
      });
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : "Failed to save workshop template");
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (!draft.id) {
      return;
    }

    setDeleting(true);
    try {
      await apiDelete(`/api/workshop/service-templates/${encodeURIComponent(draft.id)}`);
      success("Workshop service template deleted");
      setTemplates((current) => current.filter((entry) => entry.id !== draft.id));
      setRefreshNotice(null);
      resetEditor();
      void loadTemplates({
        backgroundFailureMessage:
          "Template deleted, but the template list could not refresh. Refresh the page to confirm the latest data.",
      });
    } catch (deleteError) {
      error(deleteError instanceof Error ? deleteError.message : "Failed to delete workshop template");
    } finally {
      setDeleting(false);
    }
  };

  const addLabourLine = () => {
    if (labourBuilderMessage) {
      error(labourBuilderMessage);
      return;
    }

    setDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          id: draftLineId(),
          type: "LABOUR",
          productId: null,
          productName: null,
          variantId: null,
          variantSku: null,
          description: labourDescription.trim(),
          qty: labourQty,
          unitPricePence: labourPrice,
          isOptional: false,
        },
      ],
    }));
    setLabourDescription(DEFAULT_LABOUR_DESCRIPTION);
    setLabourQty(DEFAULT_LABOUR_QTY);
    setLabourPrice(DEFAULT_LABOUR_PRICE);
  };

  const addPartLine = (result: ProductSearchRow) => {
    if (partBuilderMessage) {
      error(partBuilderMessage);
      return;
    }

    setDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          id: draftLineId(),
          type: "PART",
          productId: result.productId,
          productName: result.name,
          variantId: result.id,
          variantSku: result.sku,
          description: `${result.name} - ${result.sku}`,
          qty: partQty,
          unitPricePence: partPrice.trim() ? partPrice : penceToPoundsInput(result.pricePence),
          isOptional: partOptional,
        },
      ],
    }));
    setPartSearch("");
    setPartQty(DEFAULT_PART_QTY);
    setPartPrice("");
    setPartOptional(true);
    setPartResults([]);
  };

  const moveLine = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.lines.length) {
        return current;
      }
      const nextLines = [...current.lines];
      const [line] = nextLines.splice(index, 1);
      nextLines.splice(nextIndex, 0, line);
      return {
        ...current,
        lines: nextLines,
      };
    });
  };

  return (
    <div className="page-shell page-shell-workspace">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Service Templates</h1>
            <p className="muted-text">
              Build reusable labour and part presets so check-in and quoting stay fast and consistent without locking jobs to a long-term template dependency.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/workshop" className="button-link">Back to Workshop</Link>
            <button type="button" onClick={resetEditor}>
              New Template
            </button>
          </div>
        </div>
      </section>

      <div className="workshop-template-layout">
        <section className="card workshop-template-list">
          <div className="card-header-row">
            <div>
              <h2>Templates</h2>
              <p className="muted-text">Manager-maintained presets for common services and repair quotes.</p>
            </div>
            <span className="stock-badge stock-muted">{templates.length}</span>
          </div>

          {loading ? <p>Loading templates...</p> : null}
          {refreshNotice ? <p className="field-error">{refreshNotice}</p> : null}

          <div className="workshop-template-cards">
            {templates.length === 0 ? (
              <div className="workshop-template-empty">No workshop templates yet.</div>
            ) : templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`workshop-template-card${draft.id === template.id ? " workshop-template-card-active" : ""}`}
                onClick={() => selectTemplate(template)}
              >
                <div className="workshop-template-card-header">
                  <strong>{template.name}</strong>
                  <span className={template.isActive ? "status-badge status-complete" : "status-badge"}>
                    {template.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="table-secondary">
                  {[
                    template.category,
                    template.pricingMode === "FIXED_PRICE_SERVICE" ? "Fixed price" : "Standard service",
                    template.defaultDurationMinutes ? `${template.defaultDurationMinutes} min` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "General workshop template"}
                </div>
                <div className="table-secondary">
                  {template.lineCount} line{template.lineCount === 1 ? "" : "s"} · {formatWorkshopTemplateMoney(
                    template.pricingMode === "FIXED_PRICE_SERVICE" && template.targetTotalPricePence
                      ? template.targetTotalPricePence
                      : template.lines.reduce((sum, line) => sum + line.lineTotalPence, 0),
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="card workshop-template-editor-card">
          <div className="card-header-row">
            <div>
              <h2>{draft.id ? "Edit Template" : "New Template"}</h2>
              <p className="muted-text">
                Templates create normal workshop lines when applied, so staff can still edit the resulting job freely.
              </p>
            </div>
            {draft.id ? (
              <button type="button" onClick={deleteTemplate} disabled={deleting || saving}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
            ) : null}
          </div>

          <div className="bike-profile-grid">
            <label>
              Name
              <input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Standard service"
              />
              {!draft.name.trim() ? <div className="field-error">Template name is required.</div> : null}
            </label>
            <label>
              Category
              <input
                value={draft.category}
                onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                placeholder="Service"
              />
            </label>
            <label>
              Default duration (minutes)
              <input
                type="number"
                min={15}
                step={15}
                value={draft.defaultDurationMinutes}
                onChange={(event) => setDraft((current) => ({ ...current, defaultDurationMinutes: event.target.value }))}
                placeholder="60"
              />
            </label>
            <label>
              Pricing mode
              <select
                value={draft.pricingMode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    pricingMode: event.target.value as TemplateDraft["pricingMode"],
                    targetTotalPrice:
                      event.target.value === "FIXED_PRICE_SERVICE"
                        ? current.targetTotalPrice
                        : "",
                  }))}
              >
                <option value="STANDARD_SERVICE">Standard service (labour + parts)</option>
                <option value="FIXED_PRICE_SERVICE">Fixed price service (target total)</option>
              </select>
            </label>
            {draft.pricingMode === "FIXED_PRICE_SERVICE" ? (
              <label>
                Target total price (£)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.targetTotalPrice}
                  onChange={(event) => setDraft((current) => ({ ...current, targetTotalPrice: event.target.value }))}
                  placeholder="25.00"
                />
              </label>
            ) : null}
            <label className="staff-toggle">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Active for staff
            </label>
            <label className="grow">
              Description
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Fast city-bike service with common parts already suggested."
              />
            </label>
          </div>

          <div className="workshop-template-builder-grid">
            <section className="restricted-panel">
              <strong>Add labour line</strong>
              <div className="filter-row" style={{ marginTop: "10px" }}>
                <label className="grow">
                  Description
                  <input value={labourDescription} onChange={(event) => setLabourDescription(event.target.value)} />
                </label>
                <label>
                  Qty
                  <input type="number" min={1} value={labourQty} onChange={(event) => setLabourQty(Number(event.target.value) || 1)} />
                </label>
                <label>
                  Unit price (£)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={labourPrice}
                    onChange={(event) => setLabourPrice(event.target.value)}
                  />
                </label>
                <button type="button" onClick={addLabourLine} disabled={Boolean(labourBuilderMessage)}>
                  Add Labour
                </button>
              </div>
              <p className="muted-text workshop-template-builder-hint">
                Labour inputs are only saved to the template after you click Add Labour.
              </p>
              {labourBuilderMessage ? <p className="field-error">{labourBuilderMessage}</p> : null}
              {draft.pricingMode === "FIXED_PRICE_SERVICE" ? (
                <p className="table-secondary" style={{ marginTop: "10px" }}>
                  Fixed-price templates use this labour line as the balancing line. When the template is applied, labour automatically adjusts so the job total stays on target as parts are added.
                </p>
              ) : null}
            </section>

            <section className="restricted-panel">
              <strong>Add optional part suggestion</strong>
              <div className="filter-row" style={{ marginTop: "10px" }}>
                <label className="grow">
                  Search product
                  <input
                    value={partSearch}
                    onChange={(event) => setPartSearch(event.target.value)}
                    placeholder="name / barcode / sku"
                  />
                </label>
                <label>
                  Qty
                  <input type="number" min={1} value={partQty} onChange={(event) => setPartQty(Number(event.target.value) || 1)} />
                </label>
                <label>
                  Unit price (£)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={partPrice}
                    onChange={(event) => setPartPrice(event.target.value)}
                    placeholder="Use product price"
                  />
                </label>
                <label className="staff-toggle">
                  <input
                    type="checkbox"
                    checked={partOptional}
                    onChange={(event) => setPartOptional(event.target.checked)}
                  />
                  Optional
                </label>
              </div>
              <p className="muted-text workshop-template-builder-hint">
                Part suggestions stay optional. Search results are not part of the template until you click Add Part.
              </p>
              {partBuilderMessage ? <p className="field-error">{partBuilderMessage}</p> : null}

              <div className="table-wrap" style={{ marginTop: "10px" }}>
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
                        <td colSpan={4}>Search for a part to add a linked template line.</td>
                      </tr>
                    ) : partResults.map((result) => (
                      <tr key={result.id}>
                        <td>{result.name}</td>
                        <td>{result.sku}</td>
                        <td>{formatWorkshopTemplateMoney(result.pricePence)}</td>
                        <td>
                          <button type="button" onClick={() => addPartLine(result)} disabled={Boolean(partBuilderMessage)}>
                            Add Part
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="card-header-row">
            <div>
              <h3>Template Lines</h3>
              <p className="muted-text">
                Labour defines the service behaviour. Part suggestions stay optional and can be unticked before apply.
              </p>
            </div>
            <div className="table-secondary">{draft.lines.length} lines · {formatWorkshopTemplateMoney(totalPence)}</div>
          </div>
          {draft.lines.length === 0 ? (
            <p className="field-error">No template lines have been added yet. Add labour and any optional parts before saving.</p>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit price (£)</th>
                  <th>Linked Part</th>
                  <th>Optional</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.lines.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No template lines yet.</td>
                  </tr>
                ) : draft.lines.map((line, index) => (
                  <tr key={line.id}>
                    <td>{line.type}</td>
                    <td>
                      <input
                        value={line.description}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((entry) => entry.id === line.id
                            ? { ...entry, description: event.target.value }
                            : entry),
                        }))}
                      />
                      {draftLineMessages.find((entry) => entry.id === line.id)?.message ? (
                        <div className="field-error workshop-template-line-error">
                          {draftLineMessages.find((entry) => entry.id === line.id)?.message}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={line.qty}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((entry) => entry.id === line.id
                            ? { ...entry, qty: Number(event.target.value) || 1 }
                            : entry),
                        }))}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPricePence}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((entry) => entry.id === line.id
                            ? { ...entry, unitPricePence: event.target.value }
                            : entry),
                        }))}
                      />
                    </td>
                    <td>
                      {line.type === "PART"
                        ? [line.productName, line.variantSku].filter(Boolean).join(" · ") || "Description only"
                        : "-"}
                    </td>
                    <td>
                      {line.type === "PART" ? (
                        <input
                          type="checkbox"
                          checked={line.isOptional}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            lines: current.lines.map((entry) => entry.id === line.id
                              ? { ...entry, isOptional: event.target.checked }
                              : entry),
                          }))}
                        />
                      ) : (
                        "No"
                      )}
                    </td>
                    <td>
                      <div className="actions-inline">
                        <button type="button" onClick={() => moveLine(index, -1)} disabled={index === 0}>Up</button>
                        <button type="button" onClick={() => moveLine(index, 1)} disabled={index === draft.lines.length - 1}>Down</button>
                        <button
                          type="button"
                          onClick={() => setDraft((current) => ({
                            ...current,
                            lines: current.lines.filter((entry) => entry.id !== line.id),
                          }))}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {templateValidationMessages.length > 0 ? (
            <div className="warning-panel workshop-template-validation-summary">
              <strong>Template still needs attention</strong>
              <ul>
                {templateValidationMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted-text workshop-template-validation-summary">
              Ready to save. Template Lines are the only lines that will be applied to jobs.
            </p>
          )}

          <div className="actions-inline">
            <button type="button" className="primary" onClick={saveTemplate} disabled={!canSaveTemplate}>
              {saving ? "Saving..." : draft.id ? "Save Template" : "Create Template"}
            </button>
            <button type="button" onClick={resetEditor} disabled={saving || deleting}>
              Reset
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
