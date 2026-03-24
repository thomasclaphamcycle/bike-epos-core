import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { WorkshopServiceTemplatePreview } from "../components/WorkshopServiceTemplatePreview";
import {
  formatWorkshopTemplateMoney,
  getDefaultSelectedOptionalLineIds,
  type WorkshopServiceTemplateApplyResponse,
  type WorkshopServiceTemplate,
  type WorkshopServiceTemplatesResponse,
} from "../features/workshop/serviceTemplates";

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

type CustomerSearchResponse = {
  customers: CustomerRow[];
};

type CustomerResponse = CustomerRow & {
  notes: string | null;
};

type CustomerBikeRecord = {
  id: string;
  customerId: string;
  label: string | null;
  make: string | null;
  model: string | null;
  colour: string | null;
  frameNumber: string | null;
  serialNumber: string | null;
  registrationNumber: string | null;
  notes: string | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

type CustomerBikesResponse = {
  customerId: string;
  bikes: CustomerBikeRecord[];
};

type CustomerBikeWorkshopStartContextResponse = {
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
  bike: CustomerBikeRecord;
  defaults: {
    customerId: string;
    customerName: string;
    bikeId: string;
    bikeDescription: string;
    status: "BOOKED";
  };
  startPath: string;
};

const stepTitles = [
  "Customer",
  "Bike & Intake",
  "Review",
] as const;

const buildCheckInNotes = (input: {
  issueSummary: string;
  requestedWork: string;
  intakeNotes: string;
}) => {
  const rows = [
    input.issueSummary.trim() ? `Issue: ${input.issueSummary.trim()}` : "",
    input.requestedWork.trim() ? `Requested Work: ${input.requestedWork.trim()}` : "",
    input.intakeNotes.trim() ? `Check-in Notes: ${input.intakeNotes.trim()}` : "",
  ].filter(Boolean);

  return rows.join("\n");
};

export const WorkshopCheckInPage = () => {
  const { success, error } = useToasts();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCustomerId = searchParams.get("customerId");
  const initialBikeId = searchParams.get("bikeId");

  const [step, setStep] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 250);
  const [customerResults, setCustomerResults] = useState<CustomerRow[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerBikes, setCustomerBikes] = useState<CustomerBikeRecord[]>([]);
  const [loadingCustomerBikes, setLoadingCustomerBikes] = useState(false);
  const [workshopStartContext, setWorkshopStartContext] = useState<CustomerBikeWorkshopStartContextResponse | null>(null);
  const [loadingWorkshopStartContext, setLoadingWorkshopStartContext] = useState(false);

  const [manualCustomerName, setManualCustomerName] = useState("");
  const [createCustomerInline, setCreateCustomerInline] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const [bikeDescription, setBikeDescription] = useState("");
  const [selectedBikeId, setSelectedBikeId] = useState("");
  const [createBikeInline, setCreateBikeInline] = useState(false);
  const [bikeLabel, setBikeLabel] = useState("");
  const [bikeMake, setBikeMake] = useState("");
  const [bikeModel, setBikeModel] = useState("");
  const [bikeColour, setBikeColour] = useState("");
  const [bikeFrameNumber, setBikeFrameNumber] = useState("");
  const [bikeSerialNumber, setBikeSerialNumber] = useState("");
  const [bikeRegistrationNumber, setBikeRegistrationNumber] = useState("");
  const [bikeRecordNotes, setBikeRecordNotes] = useState("");
  const [issueSummary, setIssueSummary] = useState("");
  const [requestedWork, setRequestedWork] = useState("");
  const [intakeNotes, setIntakeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WorkshopServiceTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedOptionalTemplateLineIds, setSelectedOptionalTemplateLineIds] = useState<string[]>([]);

  const resolvedCustomerName = useMemo(() => {
    if (selectedCustomer) {
      return selectedCustomer.name;
    }
    if (createCustomerInline) {
      return newCustomerName.trim();
    }
    return manualCustomerName.trim();
  }, [createCustomerInline, manualCustomerName, newCustomerName, selectedCustomer]);

  const checkInNotes = useMemo(
    () => buildCheckInNotes({ issueSummary, requestedWork, intakeNotes }),
    [issueSummary, requestedWork, intakeNotes],
  );
  const selectedBikeRecord = useMemo(
    () => customerBikes.find((bike) => bike.id === selectedBikeId) ?? workshopStartContext?.bike ?? null,
    [customerBikes, selectedBikeId, workshopStartContext?.bike],
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );
  const canCreateBikeRecord = Boolean(selectedCustomer || createCustomerInline);

  useEffect(() => {
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
  }, [error]);

  useEffect(() => {
    setSelectedOptionalTemplateLineIds(getDefaultSelectedOptionalLineIds(selectedTemplate));
  }, [selectedTemplate]);

  useEffect(() => {
    if (!debouncedCustomerSearch.trim()) {
      setCustomerResults([]);
      return;
    }

    let cancelled = false;

    const loadCustomers = async () => {
      setLoadingCustomers(true);
      try {
        const params = new URLSearchParams({
          query: debouncedCustomerSearch.trim(),
          take: "8",
        });
        const payload = await apiGet<CustomerSearchResponse>(`/api/customers?${params.toString()}`);
        if (!cancelled) {
          setCustomerResults(payload.customers || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setCustomerResults([]);
          error(loadError instanceof Error ? loadError.message : "Failed to load customers");
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
  }, [debouncedCustomerSearch, error]);

  useEffect(() => {
    if (!initialBikeId) {
      return;
    }

    let cancelled = false;

    const loadWorkshopStartContext = async () => {
      setLoadingWorkshopStartContext(true);
      try {
        const payload = await apiGet<CustomerBikeWorkshopStartContextResponse>(
          `/api/customers/bikes/${encodeURIComponent(initialBikeId)}/workshop-start`,
        );
        if (!cancelled) {
          setWorkshopStartContext(payload);
          setSelectedCustomer(payload.customer);
          setCreateCustomerInline(false);
          setManualCustomerName("");
          setSelectedBikeId(payload.defaults.bikeId);
          setCreateBikeInline(false);
          setBikeDescription(payload.defaults.bikeDescription);
          setStep((current) => Math.max(current, 1));
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error
            ? loadError.message
            : "Failed to load selected bike";
          error(message);
        }
      } finally {
        if (!cancelled) {
          setLoadingWorkshopStartContext(false);
        }
      }
    };

    void loadWorkshopStartContext();
    return () => {
      cancelled = true;
    };
  }, [error, initialBikeId]);

  useEffect(() => {
    if (initialBikeId) {
      return;
    }

    if (!initialCustomerId) {
      return;
    }

    let cancelled = false;

    const loadInitialCustomer = async () => {
      try {
        const payload = await apiGet<CustomerResponse>(`/api/customers/${encodeURIComponent(initialCustomerId)}`);
        if (!cancelled) {
          setSelectedCustomer({
            id: payload.id,
            name: payload.name,
            email: payload.email,
            phone: payload.phone,
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          error(loadError instanceof Error ? loadError.message : "Failed to load selected customer");
        }
      }
    };

    void loadInitialCustomer();
    return () => {
      cancelled = true;
    };
  }, [error, initialBikeId, initialCustomerId]);

  useEffect(() => {
    if (!selectedCustomer?.id) {
      setCustomerBikes([]);
      setSelectedBikeId("");
      return;
    }

    let cancelled = false;

    const loadCustomerBikes = async () => {
      setLoadingCustomerBikes(true);
      try {
        const payload = await apiGet<CustomerBikesResponse>(
          `/api/customers/${encodeURIComponent(selectedCustomer.id)}/bikes`,
        );
        if (!cancelled) {
          setCustomerBikes(payload.bikes || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setCustomerBikes([]);
          error(loadError instanceof Error ? loadError.message : "Failed to load customer bikes");
        }
      } finally {
        if (!cancelled) {
          setLoadingCustomerBikes(false);
        }
      }
    };

    void loadCustomerBikes();
    return () => {
      cancelled = true;
    };
  }, [error, selectedCustomer?.id]);

  const goNext = () => {
    if (step === 0) {
      if (!resolvedCustomerName) {
        error("Choose an existing customer, create one, or enter a customer name.");
        return;
      }
    }

    if (step === 1) {
      if (!bikeDescription.trim()) {
        error("Bike description is required.");
        return;
      }
      if (!issueSummary.trim() && !requestedWork.trim() && !intakeNotes.trim()) {
        error("Capture at least one issue, requested-work, or intake note detail.");
        return;
      }
    }

    setStep((current) => Math.min(current + 1, stepTitles.length - 1));
  };

  const goBack = () => {
    setStep((current) => Math.max(current - 1, 0));
  };

  const submitCheckIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!resolvedCustomerName || !bikeDescription.trim()) {
      error("Customer and bike details are required.");
      return;
    }

    setSubmitting(true);
    try {
      let customerId = selectedCustomer?.id ?? null;

      if (!customerId && createCustomerInline) {
        const createdCustomer = await apiPost<CustomerResponse>("/api/customers", {
          name: newCustomerName.trim(),
          email: newCustomerEmail.trim() || undefined,
          phone: newCustomerPhone.trim() || undefined,
        });
        customerId = createdCustomer.id;
      }

      let bikeId = selectedBikeId || null;
      if (customerId && createBikeInline) {
        const createdBike = await apiPost<{ bike: CustomerBikeRecord }>(
          `/api/customers/${encodeURIComponent(customerId)}/bikes`,
          {
            label: bikeLabel.trim() || undefined,
            make: bikeMake.trim() || undefined,
            model: bikeModel.trim() || undefined,
            colour: bikeColour.trim() || undefined,
            frameNumber: bikeFrameNumber.trim() || undefined,
            serialNumber: bikeSerialNumber.trim() || undefined,
            registrationNumber: bikeRegistrationNumber.trim() || undefined,
            notes: bikeRecordNotes.trim() || undefined,
          },
        );
        bikeId = createdBike.bike.id;
      }

      const created = await apiPost<{ id: string }>("/api/workshop/jobs", {
        customerId,
        customerName: selectedCustomer ? undefined : resolvedCustomerName,
        bikeId,
        bikeDescription: bikeDescription.trim(),
        notes: checkInNotes || undefined,
        status: "BOOKED",
      });

      setCreatedJobId(created.id);
      if (selectedTemplateId) {
        try {
          const applyResponse = await apiPost<WorkshopServiceTemplateApplyResponse>(
            `/api/workshop/jobs/${encodeURIComponent(created.id)}/templates/apply`,
            {
              templateId: selectedTemplateId,
              selectedOptionalLineIds: selectedOptionalTemplateLineIds,
            },
          );
          success(
            applyResponse.pricingEffect.fixedPriceActivated
              ? `Workshop check-in created, fixed-price template applied, and labour will rebalance to ${formatWorkshopTemplateMoney(applyResponse.pricingEffect.targetTotalPricePence ?? 0)}`
              : applyResponse.durationEffect.durationUpdated
                ? `Workshop check-in created, template applied, and planning duration set to ${applyResponse.durationEffect.appliedDurationMinutes} min`
                : "Workshop check-in created and template applied",
          );
        } catch (templateError) {
          error(
            templateError instanceof Error
              ? `Workshop check-in created, but the template could not be applied: ${templateError.message}`
              : "Workshop check-in created, but the template could not be applied.",
          );
          return;
        }
      } else {
        success("Workshop check-in created");
      }
    } catch (submitError) {
      error(submitError instanceof Error ? submitError.message : "Failed to create workshop check-in");
    } finally {
      setSubmitting(false);
    }
  };

  const clearBikeLedContext = () => {
    setWorkshopStartContext(null);
    setSelectedCustomer(null);
    setSelectedBikeId("");
    setBikeDescription("");
    setCustomerBikes([]);
    setCreateBikeInline(false);
    setCreateCustomerInline(false);
    setStep(0);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("bikeId");
    setSearchParams(nextParams);
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Check-In</h1>
            <p className="muted-text">
              Capture customer, bike, and intake details before the job moves onto the workshop board.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/workshop">Back to workshop</Link>
            {createdJobId ? <Link to={`/workshop/${createdJobId}`}>Open created job</Link> : null}
          </div>
        </div>

        <div className="step-indicator-row">
          {stepTitles.map((title, index) => (
            <div
              key={title}
              className={`step-indicator ${index === step ? "step-indicator-active" : index < step ? "step-indicator-complete" : ""}`}
            >
              <span className="step-number">{index + 1}</span>
              <span>{title}</span>
            </div>
          ))}
        </div>
      </section>

      <form className="page-shell" onSubmit={submitCheckIn}>
        {step === 0 ? (
          <section className="card">
            <h2>Customer</h2>
            {workshopStartContext ? (
              <div className="restricted-panel info-panel" style={{ marginBottom: "12px" }}>
                <div className="job-meta-grid">
                  <div><strong>Starting from bike:</strong> <Link to={`/customers/bikes/${workshopStartContext.bike.id}`}>{workshopStartContext.bike.displayName}</Link></div>
                  <div><strong>Linked customer:</strong> <Link to={`/customers/${workshopStartContext.customer.id}`}>{workshopStartContext.customer.name}</Link></div>
                </div>
                <div className="actions-inline" style={{ marginTop: "8px" }}>
                  <button type="button" onClick={clearBikeLedContext}>
                    Use different bike / customer
                  </button>
                  <button type="button" className="primary" onClick={() => setStep(1)}>
                    Continue with linked bike
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="filter-row">
                  <label className="grow">
                    Search existing customer
                    <input
                      value={customerSearch}
                      onChange={(event) => setCustomerSearch(event.target.value)}
                      placeholder="name, phone, email"
                    />
                  </label>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Contact</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerResults.length === 0 ? (
                        <tr>
                          <td colSpan={3}>
                            {loadingCustomers
                              ? "Searching..."
                              : customerSearch.trim()
                                ? "No existing customers matched that search."
                                : "Search for an existing customer, create one inline, or use a manual intake name."}
                          </td>
                        </tr>
                      ) : customerResults.map((customer) => (
                        <tr key={customer.id}>
                          <td>{customer.name}</td>
                          <td>
                            <div>{customer.email || "-"}</div>
                            <div className="table-secondary">{customer.phone || "-"}</div>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCustomer(customer);
                                setCreateCustomerInline(false);
                                setManualCustomerName("");
                                setCreateBikeInline(false);
                              }}
                            >
                              Select
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="job-meta-grid" style={{ marginTop: "12px" }}>
                  <div>
                    <strong>Selected customer:</strong> {selectedCustomer?.name || "-"}
                  </div>
                  <div>
                    <strong>Manual intake name:</strong> {manualCustomerName || "-"}
                  </div>
                </div>

                <div className="actions-inline" style={{ marginTop: "12px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateCustomerInline(false);
                      setSelectedCustomer(null);
                      setSelectedBikeId("");
                      setCreateBikeInline(false);
                    }}
                  >
                    Use walk-in/manual name
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateCustomerInline(true);
                      setSelectedCustomer(null);
                      setManualCustomerName("");
                      setSelectedBikeId("");
                    }}
                  >
                    Create new customer
                  </button>
                </div>

                {!selectedCustomer && !createCustomerInline ? (
                  <div className="filter-row" style={{ marginTop: "12px" }}>
                    <label className="grow">
                      Customer name for intake
                      <input
                        value={manualCustomerName}
                        onChange={(event) => setManualCustomerName(event.target.value)}
                        placeholder="Walk-in customer or quick manual entry"
                      />
                    </label>
                  </div>
                ) : null}

                {createCustomerInline ? (
                  <div className="job-meta-grid" style={{ marginTop: "12px" }}>
                    <label>
                      New customer name
                      <input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} />
                    </label>
                    <label>
                      Email
                      <input value={newCustomerEmail} onChange={(event) => setNewCustomerEmail(event.target.value)} />
                    </label>
                    <label>
                      Phone
                      <input value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} />
                    </label>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {step === 1 ? (
          <section className="card">
            <h2>Bike & Intake</h2>
            {loadingWorkshopStartContext ? <p>Loading selected bike...</p> : null}
            {workshopStartContext ? (
              <div className="restricted-panel info-panel" style={{ marginBottom: "12px" }}>
                <div className="job-meta-grid">
                  <div><strong>Known bike:</strong> <Link to={`/customers/bikes/${workshopStartContext.bike.id}`}>{workshopStartContext.bike.displayName}</Link></div>
                  <div><strong>Customer:</strong> <Link to={`/customers/${workshopStartContext.customer.id}`}>{workshopStartContext.customer.name}</Link></div>
                  <div><strong>Bike notes:</strong> {workshopStartContext.bike.notes || "-"}</div>
                  <div><strong>Prefilled summary:</strong> {workshopStartContext.defaults.bikeDescription}</div>
                </div>
                <div className="actions-inline" style={{ marginTop: "8px" }}>
                  <button type="button" onClick={clearBikeLedContext}>
                    Change bike / customer
                  </button>
                </div>
              </div>
            ) : null}
            {canCreateBikeRecord ? (
              <>
                <div className="job-meta-grid">
                  <label>
                    Linked bike record
                    <select
                      value={createBikeInline ? "__new__" : selectedBikeId}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        if (nextValue === "__new__") {
                          setCreateBikeInline(true);
                          setSelectedBikeId("");
                          return;
                        }

                        setCreateBikeInline(false);
                        setSelectedBikeId(nextValue);
                        const matchedBike = customerBikes.find((bike) => bike.id === nextValue);
                        if (matchedBike) {
                          setBikeDescription(matchedBike.displayName);
                        }
                      }}
                    >
                      <option value="">No linked bike record</option>
                      {customerBikes.map((bike) => (
                        <option key={bike.id} value={bike.id}>
                          {bike.displayName}
                        </option>
                      ))}
                      <option value="__new__">Create new bike record</option>
                    </select>
                  </label>
                  <div className="table-secondary">
                    {loadingCustomerBikes
                      ? "Loading existing bike records..."
                      : selectedCustomer
                        ? `${customerBikes.length} bike record${customerBikes.length === 1 ? "" : "s"} found for ${selectedCustomer.name}.`
                        : "New customer will receive the bike record when the check-in is created."}
                  </div>
                </div>

                {createBikeInline ? (
                  <div className="job-meta-grid" style={{ marginTop: "12px" }}>
                    <label>
                      Nickname / label
                      <input value={bikeLabel} onChange={(event) => setBikeLabel(event.target.value)} placeholder="Winter commuter" />
                    </label>
                    <label>
                      Make
                      <input value={bikeMake} onChange={(event) => setBikeMake(event.target.value)} placeholder="Trek" />
                    </label>
                    <label>
                      Model
                      <input value={bikeModel} onChange={(event) => setBikeModel(event.target.value)} placeholder="Domane AL 2" />
                    </label>
                    <label>
                      Colour
                      <input value={bikeColour} onChange={(event) => setBikeColour(event.target.value)} placeholder="Blue" />
                    </label>
                    <label>
                      Frame number
                      <input value={bikeFrameNumber} onChange={(event) => setBikeFrameNumber(event.target.value)} />
                    </label>
                    <label>
                      Serial number
                      <input value={bikeSerialNumber} onChange={(event) => setBikeSerialNumber(event.target.value)} />
                    </label>
                    <label>
                      Registration
                      <input value={bikeRegistrationNumber} onChange={(event) => setBikeRegistrationNumber(event.target.value)} />
                    </label>
                    <label className="grow">
                      Bike record notes
                      <textarea value={bikeRecordNotes} onChange={(event) => setBikeRecordNotes(event.target.value)} rows={3} />
                    </label>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="muted-text">
                Bike records can be linked once you choose or create a customer. Manual walk-in check-ins still use the bike summary below.
              </p>
            )}
            <div className="job-meta-grid">
              <label>
                Workshop bike summary
                <input
                  value={bikeDescription}
                  onChange={(event) => setBikeDescription(event.target.value)}
                  placeholder={workshopStartContext ? "Prefilled from the linked bike record" : "e.g. Trek road bike, blue, 56cm"}
                />
              </label>
              <label>
                Issue / symptoms
                <textarea
                  value={issueSummary}
                  onChange={(event) => setIssueSummary(event.target.value)}
                  rows={4}
                  placeholder="What the customer reports is wrong"
                />
              </label>
              <label>
                Requested work
                <textarea
                  value={requestedWork}
                  onChange={(event) => setRequestedWork(event.target.value)}
                  rows={4}
                  placeholder="Requested repair / service scope"
                />
              </label>
              <label>
                Intake notes
                <textarea
                  value={intakeNotes}
                  onChange={(event) => setIntakeNotes(event.target.value)}
                  rows={4}
                  placeholder="Accessories left with bike, visible damage, extra notes"
                />
              </label>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="card">
            <h2>Review & Confirm</h2>
            <p className="muted-text">Create the check-in to open the job and continue progress from the workshop dashboard.</p>
            <div className="job-meta-grid">
              <div><strong>Customer:</strong> {resolvedCustomerName}</div>
              <div><strong>Workshop bike summary:</strong> {bikeDescription || "-"}</div>
              <div>
                <strong>Bike record:</strong>{" "}
                {createBikeInline
                  ? "Create new bike record with this check-in"
                  : selectedBikeId
                    ? selectedBikeRecord?.displayName || "Existing bike selected"
                    : "No linked bike record"}
              </div>
              <div>
                <strong>Bike-led intake:</strong>{" "}
                {workshopStartContext
                  ? `Started from ${workshopStartContext.bike.displayName}`
                  : "Manual check-in flow"}
              </div>
            </div>
            <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
              <strong>Check-in summary</strong>
              <pre className="note-pre">{checkInNotes || "No additional notes captured."}</pre>
            </div>
            <div className="job-meta-grid" style={{ marginTop: "12px" }}>
              <label>
                Service template
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
              </label>
              <div className="table-secondary">
                {loadingTemplates
                  ? "Loading active service templates..."
                  : selectedTemplate
                    ? "Template lines will be applied after the check-in creates the workshop job."
                    : "Templates can prefill common labour and part suggestions."}
              </div>
            </div>
            {selectedTemplate ? (
              <div style={{ marginTop: "12px" }}>
                <WorkshopServiceTemplatePreview
                  template={selectedTemplate}
                  selectedOptionalLineIds={selectedOptionalTemplateLineIds}
                  onToggleOptionalLine={(lineId) =>
                    setSelectedOptionalTemplateLineIds((current) =>
                      current.includes(lineId)
                        ? current.filter((entry) => entry !== lineId)
                        : [...current, lineId],
                    )}
                  emptyOptionalLabel="Optional part suggestions are currently included in this check-in."
                />
              </div>
            ) : null}
            {createdJobId ? (
              <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
                Workshop job created: <Link to={`/workshop/${createdJobId}`}>{createdJobId}</Link>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="card">
          <div className="actions-inline">
            <button type="button" onClick={goBack} disabled={step === 0}>
              Back
            </button>
            {step < stepTitles.length - 1 ? (
              <button type="button" className="primary" onClick={goNext}>
                Next
              </button>
            ) : (
              <button type="submit" className="primary" disabled={submitting || Boolean(createdJobId)}>
                {submitting ? "Creating..." : createdJobId ? "Created" : "Create check-in"}
              </button>
            )}
          </div>
        </section>
      </form>
    </div>
  );
};
