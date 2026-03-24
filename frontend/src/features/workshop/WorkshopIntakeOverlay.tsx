import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../../api/client";
import { WorkshopServiceTemplatePreview } from "../../components/WorkshopServiceTemplatePreview";
import { useToasts } from "../../components/ToastProvider";
import {
  type WorkshopServiceTemplate,
  type WorkshopServiceTemplateApplyResponse,
  type WorkshopServiceTemplatesResponse,
  getDefaultSelectedOptionalLineIds,
} from "./serviceTemplates";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type CustomerSearchResponse = {
  customers: CustomerRow[];
};

type CustomerCreateResponse = CustomerRow & {
  firstName: string;
  lastName: string;
  notes: string | null;
};

type TechnicianOption = {
  id: string;
  name: string;
};

type WorkshopIntakeOverlayProps = {
  open: boolean;
  technicianOptions: TechnicianOption[];
  defaultTechnicianId?: string;
  onClose: () => void;
  onCreated: (jobId: string) => Promise<void> | void;
};

type IntakeSectionKey =
  | "customer"
  | "bike"
  | "issue"
  | "planning"
  | "estimate"
  | "notes";

const DEFAULT_COLLAPSED_SECTIONS: Record<IntakeSectionKey, boolean> = {
  customer: false,
  bike: false,
  issue: false,
  planning: false,
  estimate: false,
  notes: false,
};

const buildCheckInNotes = (input: {
  issueSummary: string;
  intakeNotes: string;
}) => {
  const rows = [
    input.issueSummary.trim() ? `Issue: ${input.issueSummary.trim()}` : "",
    input.intakeNotes.trim() ? `Check-in Notes: ${input.intakeNotes.trim()}` : "",
  ].filter(Boolean);

  return rows.join("\n");
};

const getCustomerContactSummary = (customer: CustomerRow) =>
  [customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact details on file";

const getCustomerSearchMeta = (customer: CustomerRow) =>
  `Email: ${customer.email || "-"} · Phone: ${customer.phone || "-"}`;

const splitSearchIntoNameParts = (value: string) => {
  if (value.includes("@") && !value.includes(" ")) {
    return {
      firstName: "",
      lastName: "",
    };
  }

  const tokens = value
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      firstName: "",
      lastName: "",
    };
  }

  if (tokens.length === 1) {
    return {
      firstName: tokens[0],
      lastName: "",
    };
  }

  return {
    firstName: tokens[0],
    lastName: tokens.slice(1).join(" "),
  };
};

export const WorkshopIntakeOverlay = ({
  open,
  technicianOptions,
  defaultTechnicianId,
  onClose,
  onCreated,
}: WorkshopIntakeOverlayProps) => {
  const { success, error } = useToasts();
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 250);
  const [customerResults, setCustomerResults] = useState<CustomerRow[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [createCustomerFirstName, setCreateCustomerFirstName] = useState("");
  const [createCustomerLastName, setCreateCustomerLastName] = useState("");
  const [createCustomerEmail, setCreateCustomerEmail] = useState("");
  const [createCustomerPhone, setCreateCustomerPhone] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [showCreateCustomerForm, setShowCreateCustomerForm] = useState(false);
  const [firstNameDirty, setFirstNameDirty] = useState(false);
  const [lastNameDirty, setLastNameDirty] = useState(false);
  const [bikeDescription, setBikeDescription] = useState("");
  const [issueSummary, setIssueSummary] = useState("");
  const [intakeNotes, setIntakeNotes] = useState("");
  const [promisedDate, setPromisedDate] = useState("");
  const [assignedStaffId, setAssignedStaffId] = useState("");
  const [quickMode, setQuickMode] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<IntakeSectionKey, boolean>>(DEFAULT_COLLAPSED_SECTIONS);
  const [templates, setTemplates] = useState<WorkshopServiceTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedOptionalTemplateLineIds, setSelectedOptionalTemplateLineIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasCustomerSearch = useMemo(
    () => !selectedCustomer && debouncedCustomerSearch.trim().length > 0,
    [debouncedCustomerSearch, selectedCustomer],
  );

  const shouldShowInlineCreate = hasCustomerSearch && showCreateCustomerForm;
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    if (!open) {
      setCustomerSearch("");
      setCustomerResults([]);
      setLoadingCustomers(false);
      setSelectedCustomer(null);
      setCreateCustomerFirstName("");
      setCreateCustomerLastName("");
      setCreateCustomerEmail("");
      setCreateCustomerPhone("");
      setCreatingCustomer(false);
      setShowCreateCustomerForm(false);
      setFirstNameDirty(false);
      setLastNameDirty(false);
      setBikeDescription("");
      setIssueSummary("");
      setIntakeNotes("");
      setPromisedDate("");
      setAssignedStaffId(defaultTechnicianId ?? "");
      setQuickMode(false);
      setCollapsedSections(DEFAULT_COLLAPSED_SECTIONS);
      setTemplates([]);
      setLoadingTemplates(false);
      setSelectedTemplateId("");
      setSelectedOptionalTemplateLineIds([]);
      setSubmitError(null);
      setSubmitting(false);
      return;
    }

    setAssignedStaffId(defaultTechnicianId ?? "");
  }, [defaultTechnicianId, open]);

  useEffect(() => {
    if (!hasCustomerSearch) {
      setShowCreateCustomerForm(false);
    }
  }, [hasCustomerSearch]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const loadTemplates = async () => {
      setLoadingTemplates(true);
      try {
        const payload = await apiGet<WorkshopServiceTemplatesResponse>("/api/workshop/service-templates");
        if (!cancelled) {
          setTemplates(payload.templates || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to load service templates");
        }
      } finally {
        if (!cancelled) {
          setLoadingTemplates(false);
        }
      }
    };

    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [error, open]);

  useEffect(() => {
    if (!shouldShowInlineCreate) {
      return;
    }

    const nameParts = splitSearchIntoNameParts(customerSearch);

    if (!firstNameDirty) {
      setCreateCustomerFirstName(nameParts.firstName);
    }

    if (!lastNameDirty) {
      setCreateCustomerLastName(nameParts.lastName);
    }
  }, [customerSearch, firstNameDirty, lastNameDirty, shouldShowInlineCreate]);

  useEffect(() => {
    setSelectedOptionalTemplateLineIds(getDefaultSelectedOptionalLineIds(selectedTemplate));
  }, [selectedTemplate]);

  useEffect(() => {
    if (!open || !debouncedCustomerSearch.trim()) {
      setCustomerResults([]);
      return;
    }

    let cancelled = false;

    const loadCustomers = async () => {
      setLoadingCustomers(true);
      try {
        const query = new URLSearchParams({
          query: debouncedCustomerSearch.trim(),
          take: "8",
        });
        const payload = await apiGet<CustomerSearchResponse>(`/api/customers?${query.toString()}`);
        if (!cancelled) {
          setCustomerResults(payload.customers || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setCustomerResults([]);
          error(loadError instanceof Error ? loadError.message : "Failed to search customers");
        }
      } finally {
        if (!cancelled) {
          setLoadingCustomers(false);
        }
      }
    };

    void loadCustomers();
    return () => {
      cancelled = true;
    };
  }, [debouncedCustomerSearch, error, open]);

  if (!open) {
    return null;
  }

  const openCreateCustomerForm = () => {
    const nameParts = splitSearchIntoNameParts(customerSearch);
    setShowCreateCustomerForm(true);
    if (!firstNameDirty) {
      setCreateCustomerFirstName(nameParts.firstName);
    }
    if (!lastNameDirty) {
      setCreateCustomerLastName(nameParts.lastName);
    }
  };

  const toggleSection = (section: IntakeSectionKey) => {
    setCollapsedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const isSectionVisible = (section: IntakeSectionKey) =>
    !quickMode || section === "customer" || section === "bike" || section === "issue";

  const isSectionCollapsed = (section: IntakeSectionKey) => collapsedSections[section];

  const submitCheckIn = async (event: FormEvent) => {
    event.preventDefault();

    if (!selectedCustomer && !shouldShowInlineCreate) {
      setSubmitError("Select an existing customer or choose create new customer.");
      return;
    }

    if (!selectedCustomer) {
      if (!createCustomerFirstName.trim()) {
        setSubmitError("First name is required.");
        return;
      }
      if (!createCustomerLastName.trim()) {
        setSubmitError("Last name is required.");
        return;
      }
      if (!createCustomerEmail.trim()) {
        setSubmitError("Email is required.");
        return;
      }
    }

    if (!bikeDescription.trim()) {
      setSubmitError("Bike summary is required.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      let customerId = selectedCustomer?.id ?? null;

      if (!customerId) {
        setCreatingCustomer(true);
        const createdCustomer = await apiPost<CustomerCreateResponse>("/api/customers", {
          firstName: createCustomerFirstName.trim(),
          lastName: createCustomerLastName.trim(),
          email: createCustomerEmail.trim(),
          phone: createCustomerPhone.trim() || undefined,
        });
        customerId = createdCustomer.id;
      }

      const created = await apiPost<{ id: string }>("/api/workshop/jobs", {
        customerId,
        bikeDescription: bikeDescription.trim(),
        notes: buildCheckInNotes({
          issueSummary,
          intakeNotes,
        }) || undefined,
        scheduledDate: promisedDate || undefined,
        status: "BOOKED",
      });

      let assignmentError: string | null = null;
      if (assignedStaffId) {
        try {
          await apiPost(`/api/workshop/jobs/${encodeURIComponent(created.id)}/assign`, {
            staffId: assignedStaffId,
          });
        } catch (assignError) {
          assignmentError = assignError instanceof Error ? assignError.message : "Failed to assign technician";
        }
      }

      let templateError: string | null = null;
      if (selectedTemplateId) {
        try {
          await apiPost<WorkshopServiceTemplateApplyResponse>(
            `/api/workshop/jobs/${encodeURIComponent(created.id)}/templates/apply`,
            {
              templateId: selectedTemplateId,
              selectedOptionalLineIds: selectedOptionalTemplateLineIds,
            },
          );
        } catch (applyError) {
          templateError = applyError instanceof Error ? applyError.message : "Failed to apply service template";
        }
      }

      onClose();
      await Promise.resolve(onCreated(created.id));

      if (assignmentError || templateError) {
        const followUpIssues = [assignmentError, templateError].filter(Boolean).join(" ");
        error(`Workshop job created, but follow-up setup failed: ${followUpIssues}`);
      } else {
        success("Workshop job created");
      }
    } catch (submitFailure) {
      const message = submitFailure instanceof Error ? submitFailure.message : "Failed to create workshop job";
      setSubmitError(message);
      error(message);
    } finally {
      setCreatingCustomer(false);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="workshop-os-drawer-backdrop"
      onClick={onClose}
      aria-hidden="true"
    >
      <aside
        className="workshop-os-drawer workshop-os-intake-drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New workshop job intake"
      >
        <div className="workshop-os-drawer__header">
          <div>
            <h2>New Job</h2>
            <p className="table-secondary">
              Build the job in one pass with customer, bike, planning, estimate, notes, and attachments guidance in the same drawer.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close new job intake">
            Close
          </button>
        </div>

        <div className="workshop-os-intake-mode-row">
          <div className="table-secondary">
            {quickMode
              ? "Quick mode keeps only the essential counter fields visible."
              : "Full intake is the default so planning, estimate setup, and notes are ready from the start."}
          </div>
          <label className="workshop-os-intake-mode-toggle">
            <input
              type="checkbox"
              checked={quickMode}
              onChange={(event) => setQuickMode(event.target.checked)}
            />
            <span>Quick mode</span>
          </label>
        </div>

        <form className="workshop-os-intake-form" onSubmit={submitCheckIn}>
          {isSectionVisible("customer") ? (
            <section className="workshop-os-drawer__section workshop-os-intake-section">
              <button
                type="button"
                className="workshop-os-intake-section-toggle"
                onClick={() => toggleSection("customer")}
                aria-expanded={!isSectionCollapsed("customer")}
              >
                <span className="workshop-os-intake-section-toggle-copy">
                  <strong>Customer</strong>
                  <span className="table-secondary">Every workshop job starts with a linked customer record.</span>
                </span>
                <span className="button-link--inline">{isSectionCollapsed("customer") ? "Expand" : "Collapse"}</span>
              </button>

              {!isSectionCollapsed("customer") ? (
                <div className="workshop-os-intake-section-body">
                  <label className="workshop-os-intake-field">
                    <span>Search or create customer</span>
                    <input
                      id="create-customer"
                      value={customerSearch}
                      onChange={(event) => {
                        setCustomerSearch(event.target.value);
                        setSubmitError(null);
                      }}
                      placeholder="Search name, email, or phone"
                    />
                  </label>

                  {selectedCustomer ? (
                    <div className="workshop-os-intake-customer-pill">
                      <div>
                        <strong>{selectedCustomer.name}</strong>
                        <div className="table-secondary">{getCustomerContactSummary(selectedCustomer)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(null);
                          setCustomerSearch(selectedCustomer.name);
                          setCustomerResults([]);
                          setShowCreateCustomerForm(false);
                          setSubmitError(null);
                        }}
                      >
                        Change customer
                      </button>
                    </div>
                  ) : null}

                  <div className="workshop-os-intake-search-results">
                    {loadingCustomers ? (
                      <div className="workshop-os-empty-card">Searching customers...</div>
                    ) : null}

                    {!loadingCustomers && hasCustomerSearch && customerResults.length === 0 ? (
                      <div className="workshop-os-empty-card workshop-os-empty-card--action">
                        <div>
                          <strong>No existing customers matched that search.</strong>
                          <div className="table-secondary">Select a match or create a new linked customer without leaving this panel.</div>
                        </div>
                      </div>
                    ) : null}

                    {!loadingCustomers ? customerResults.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        className="workshop-os-intake-search-result"
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setCustomerSearch(customer.name);
                          setCustomerResults([]);
                          setShowCreateCustomerForm(false);
                          setSubmitError(null);
                        }}
                      >
                        <div>
                          <strong>{customer.name}</strong>
                          <div className="table-secondary">{getCustomerSearchMeta(customer)}</div>
                        </div>
                        <span className="button-link--inline">Select</span>
                      </button>
                    )) : null}

                    {!loadingCustomers && hasCustomerSearch ? (
                      <button
                        type="button"
                        className="workshop-os-intake-search-result workshop-os-intake-search-result--create"
                        onClick={openCreateCustomerForm}
                      >
                        <div>
                          <strong>+ Create new customer &ldquo;{customerSearch.trim()}&rdquo;</strong>
                          <div className="table-secondary">Open a lightweight inline form and keep this intake moving.</div>
                        </div>
                        <span className="button-link--inline">Create</span>
                      </button>
                    ) : null}
                  </div>

                  {shouldShowInlineCreate ? (
                    <div className="workshop-os-intake-advanced">
                      <div className="workshop-os-intake-section-header">
                        <h3>Create new customer</h3>
                        <span className="table-secondary">Create the customer inline and keep the job linked from the start.</span>
                      </div>
                      <div className="workshop-os-intake-inline-actions">
                        <button
                          type="button"
                          className="button-link--inline"
                          onClick={() => setShowCreateCustomerForm(false)}
                        >
                          Back to search
                        </button>
                      </div>
                      <div className="workshop-os-intake-grid">
                        <label className="workshop-os-intake-field">
                          <span>First name</span>
                          <input
                            id="create-customer-first-name"
                            value={createCustomerFirstName}
                            onChange={(event) => {
                              setCreateCustomerFirstName(event.target.value);
                              setFirstNameDirty(true);
                            }}
                            placeholder="Jamie"
                          />
                        </label>
                        <label className="workshop-os-intake-field">
                          <span>Last name</span>
                          <input
                            id="create-customer-last-name"
                            value={createCustomerLastName}
                            onChange={(event) => {
                              setCreateCustomerLastName(event.target.value);
                              setLastNameDirty(true);
                            }}
                            placeholder="Taylor"
                          />
                        </label>
                        <label className="workshop-os-intake-field">
                          <span>Email</span>
                          <input
                            id="create-customer-email"
                            type="email"
                            value={createCustomerEmail}
                            onChange={(event) => setCreateCustomerEmail(event.target.value)}
                            placeholder="jamie@example.com"
                          />
                        </label>
                        <label className="workshop-os-intake-field">
                          <span>Phone</span>
                          <input
                            id="create-customer-phone"
                            value={createCustomerPhone}
                            onChange={(event) => setCreateCustomerPhone(event.target.value)}
                            placeholder="Optional"
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {isSectionVisible("bike") ? (
            <section className="workshop-os-drawer__section workshop-os-intake-section">
              <button
                type="button"
                className="workshop-os-intake-section-toggle"
                onClick={() => toggleSection("bike")}
                aria-expanded={!isSectionCollapsed("bike")}
              >
                <span className="workshop-os-intake-section-toggle-copy">
                  <strong>Bike</strong>
                  <span className="table-secondary">Capture the bike summary clearly so the bench and front counter are aligned.</span>
                </span>
                <span className="button-link--inline">{isSectionCollapsed("bike") ? "Expand" : "Collapse"}</span>
              </button>

              {!isSectionCollapsed("bike") ? (
                <div className="workshop-os-intake-section-body">
                  <label className="workshop-os-intake-field">
                    <span>Bike summary</span>
                    <input
                      value={bikeDescription}
                      onChange={(event) => setBikeDescription(event.target.value)}
                      placeholder="e.g. Trek FX 2, blue commuter, medium"
                      id="create-bike"
                    />
                  </label>
                </div>
              ) : null}
            </section>
          ) : null}

          {isSectionVisible("issue") ? (
            <section className="workshop-os-drawer__section workshop-os-intake-section">
              <button
                type="button"
                className="workshop-os-intake-section-toggle"
                onClick={() => toggleSection("issue")}
                aria-expanded={!isSectionCollapsed("issue")}
              >
                <span className="workshop-os-intake-section-toggle-copy">
                  <strong>Issue</strong>
                  <span className="table-secondary">Capture the customer-reported problem in concise operational language.</span>
                </span>
                <span className="button-link--inline">{isSectionCollapsed("issue") ? "Expand" : "Collapse"}</span>
              </button>

              {!isSectionCollapsed("issue") ? (
                <div className="workshop-os-intake-section-body">
                  <label className="workshop-os-intake-field">
                    <span>Issue</span>
                    <textarea
                      value={issueSummary}
                      onChange={(event) => setIssueSummary(event.target.value)}
                      rows={4}
                      placeholder="What’s wrong or what the customer reported"
                    />
                  </label>
                </div>
              ) : null}
            </section>
          ) : null}

          {isSectionVisible("planning") ? (
            <section className="workshop-os-drawer__section workshop-os-intake-section">
              <button
                type="button"
                className="workshop-os-intake-section-toggle"
                onClick={() => toggleSection("planning")}
                aria-expanded={!isSectionCollapsed("planning")}
              >
                <span className="workshop-os-intake-section-toggle-copy">
                  <strong>Planning</strong>
                  <span className="table-secondary">Set the due date and optional technician coverage without leaving the drawer.</span>
                </span>
                <span className="button-link--inline">{isSectionCollapsed("planning") ? "Expand" : "Collapse"}</span>
              </button>

              {!isSectionCollapsed("planning") ? (
                <div className="workshop-os-intake-section-body">
                  <div className="workshop-os-intake-grid workshop-os-intake-grid--compact">
                    <label className="workshop-os-intake-field">
                      <span>Promised date</span>
                      <input
                        type="date"
                        value={promisedDate}
                        onChange={(event) => setPromisedDate(event.target.value)}
                      />
                      <small className="table-secondary">Sets the queue due date. Exact timing can be refined later in Calendar.</small>
                    </label>

                    {technicianOptions.length ? (
                      <label className="workshop-os-intake-field">
                        <span>Technician</span>
                        <select value={assignedStaffId} onChange={(event) => setAssignedStaffId(event.target.value)}>
                          <option value="">Leave unassigned</option>
                          {technicianOptions.map((technician) => (
                            <option key={technician.id} value={technician.id}>
                              {technician.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="workshop-os-empty-card workshop-os-intake-note-card">
                        No technician list is currently available. Leave the job unassigned and plan it from Calendar later.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {isSectionVisible("estimate") ? (
            <section className="workshop-os-drawer__section workshop-os-intake-section">
              <button
                type="button"
                className="workshop-os-intake-section-toggle"
                onClick={() => toggleSection("estimate")}
                aria-expanded={!isSectionCollapsed("estimate")}
              >
                <span className="workshop-os-intake-section-toggle-copy">
                  <strong>Estimate</strong>
                  <span className="table-secondary">Use templates to seed labour and optional parts as part of intake.</span>
                </span>
                <span className="button-link--inline">{isSectionCollapsed("estimate") ? "Expand" : "Collapse"}</span>
              </button>

              {!isSectionCollapsed("estimate") ? (
                <div className="workshop-os-intake-section-body">
                  <label className="workshop-os-intake-field">
                    <span>Service template</span>
                    <select
                      value={selectedTemplateId}
                      onChange={(event) => setSelectedTemplateId(event.target.value)}
                    >
                      <option value="">No template</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                    <small className="table-secondary">
                      {loadingTemplates
                        ? "Loading active service templates..."
                        : selectedTemplate
                          ? "The selected template will apply its labour and optional part lines after the job is created."
                          : "Choose a template to prefill common labour and part suggestions."}
                    </small>
                  </label>

                  {selectedTemplate ? (
                    <WorkshopServiceTemplatePreview
                      template={selectedTemplate}
                      selectedOptionalLineIds={selectedOptionalTemplateLineIds}
                      onToggleOptionalLine={(lineId) =>
                        setSelectedOptionalTemplateLineIds((current) =>
                          current.includes(lineId)
                            ? current.filter((entry) => entry !== lineId)
                            : [...current, lineId],
                        )}
                      emptyOptionalLabel="Optional part suggestions are currently included in this intake."
                    />
                  ) : (
                    <div className="workshop-os-empty-card workshop-os-intake-note-card">
                      No template selected yet. You can still create the job now and add manual labour or parts on the job page afterwards.
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          {isSectionVisible("notes") ? (
            <section className="workshop-os-drawer__section workshop-os-intake-section">
              <button
                type="button"
                className="workshop-os-intake-section-toggle"
                onClick={() => toggleSection("notes")}
                aria-expanded={!isSectionCollapsed("notes")}
              >
                <span className="workshop-os-intake-section-toggle-copy">
                  <strong>Notes and attachments</strong>
                  <span className="table-secondary">Capture handover notes now and keep attachment guidance visible in the same intake flow.</span>
                </span>
                <span className="button-link--inline">{isSectionCollapsed("notes") ? "Expand" : "Collapse"}</span>
              </button>

              {!isSectionCollapsed("notes") ? (
                <div className="workshop-os-intake-section-body">
                  <label className="workshop-os-intake-field">
                    <span>Notes</span>
                    <textarea
                      value={intakeNotes}
                      onChange={(event) => setIntakeNotes(event.target.value)}
                      rows={4}
                      placeholder="Accessories left with bike, visible damage, useful notes"
                      id="create-notes"
                    />
                  </label>

                  <div className="workshop-os-empty-card workshop-os-intake-note-card">
                    Attachments are added after the job exists. Create the job first, then open the full job page to upload photos or files for the bench and customer portal.
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {submitError ? (
            <div className="restricted-panel warning-panel" id="job-create-status">
              {submitError}
            </div>
          ) : null}

          <div className="workshop-os-intake-footer">
            <Link to="/workshop/check-in" className="button-link">
              Open full check-in
            </Link>
            <div className="workshop-os-drawer__actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={submitting} id="create-job">
                {submitting ? (creatingCustomer ? "Creating customer..." : "Creating job...") : "Create job"}
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
};
