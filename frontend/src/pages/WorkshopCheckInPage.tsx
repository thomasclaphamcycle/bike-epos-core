import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  problemWork: string;
  additionalNotes: string;
}) => {
  const rows = [
    input.problemWork.trim() ? `Problem / Work: ${input.problemWork.trim()}` : "",
    input.additionalNotes.trim() ? `Additional notes: ${input.additionalNotes.trim()}` : "",
  ].filter(Boolean);

  return rows.join("\n");
};

const buildBikeDraftDisplayName = (input: {
  label: string;
  make: string;
  model: string;
  colour: string;
  frameNumber: string;
  serialNumber: string;
  registrationNumber: string;
}) => {
  const label = input.label.trim();
  const makeModel = [input.make.trim(), input.model.trim()].filter(Boolean).join(" ");
  const colour = input.colour.trim();
  const identifier = input.registrationNumber.trim() || input.serialNumber.trim() || input.frameNumber.trim();
  const primary = [label, makeModel].filter(Boolean).join(" · ");

  if (primary) {
    return [primary, colour, identifier].filter(Boolean).join(" | ");
  }

  const fallback = [makeModel, colour, identifier].filter(Boolean).join(" | ");
  return fallback || "New bike record";
};

type WorkshopCheckInPageProps = {
  embedded?: boolean;
  onClose?: () => void;
  onCreated?: (jobId: string) => Promise<void> | void;
};

const renderStepIndicators = (step: number): ReactNode => (
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
);

export const WorkshopCheckInPage = ({
  embedded = false,
  onClose,
  onCreated,
}: WorkshopCheckInPageProps = {}) => {
  const { success, error } = useToasts();
  const customerOptionRefs = useRef<Array<HTMLElement | null>>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCustomerId = searchParams.get("customerId");
  const initialBikeId = searchParams.get("bikeId");

  const [step, setStep] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 250);
  const [customerResults, setCustomerResults] = useState<CustomerRow[]>([]);
  const [highlightedCustomerOptionIndex, setHighlightedCustomerOptionIndex] = useState(-1);
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
  const [bikeSearchModalOpen, setBikeSearchModalOpen] = useState(false);
  const [bikeCreateModalOpen, setBikeCreateModalOpen] = useState(false);
  const [bikeSearchText, setBikeSearchText] = useState("");
  const [problemWork, setProblemWork] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
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
    () => buildCheckInNotes({ problemWork, additionalNotes }),
    [additionalNotes, problemWork],
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
  const bikeDraftDisplayName = useMemo(
    () =>
      buildBikeDraftDisplayName({
        label: bikeLabel,
        make: bikeMake,
        model: bikeModel,
        colour: bikeColour,
        frameNumber: bikeFrameNumber,
        serialNumber: bikeSerialNumber,
        registrationNumber: bikeRegistrationNumber,
      }),
    [bikeColour, bikeFrameNumber, bikeLabel, bikeMake, bikeModel, bikeRegistrationNumber, bikeSerialNumber],
  );
  const trimmedCustomerSearch = customerSearch.trim();
  const showInlineCreateCustomerOption = useMemo(() => {
    if (!trimmedCustomerSearch || loadingCustomers) {
      return false;
    }

    const normalizedSearch = trimmedCustomerSearch.toLocaleLowerCase();
    return !customerResults.some((customer) => customer.name.trim().toLocaleLowerCase() === normalizedSearch);
  }, [customerResults, loadingCustomers, trimmedCustomerSearch]);
  const customerSearchOptionCount = customerResults.length + (showInlineCreateCustomerOption ? 1 : 0);
  const filteredCustomerBikes = useMemo(() => {
    const query = bikeSearchText.trim().toLocaleLowerCase();
    if (!query) {
      return customerBikes;
    }

    return customerBikes.filter((bike) =>
      [
        bike.displayName,
        bike.label,
        bike.make,
        bike.model,
        bike.colour,
        bike.registrationNumber,
        bike.serialNumber,
        bike.frameNumber,
        bike.notes,
      ]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query)),
    );
  }, [bikeSearchText, customerBikes]);

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
    if (!trimmedCustomerSearch || customerSearchOptionCount === 0) {
      setHighlightedCustomerOptionIndex(-1);
      customerOptionRefs.current = [];
      return;
    }

    setHighlightedCustomerOptionIndex(0);
  }, [customerResults, customerSearchOptionCount, showInlineCreateCustomerOption, trimmedCustomerSearch]);

  useEffect(() => {
    if (highlightedCustomerOptionIndex < 0) {
      return;
    }

    customerOptionRefs.current[highlightedCustomerOptionIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [highlightedCustomerOptionIndex]);

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
      if (!problemWork.trim()) {
        error("Problem / Work is required.");
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

      if (onCreated) {
        try {
          await Promise.resolve(onCreated(created.id));
        } catch (refreshError) {
          error(
            refreshError instanceof Error
              ? `Workshop check-in created, but the Workshop Operating Screen could not refresh: ${refreshError.message}`
              : "Workshop check-in created, but the Workshop Operating Screen could not refresh.",
          );
          return;
        }
      }

      if (embedded) {
        onClose?.();
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

  const resetBikeDraft = () => {
    setCreateBikeInline(false);
    setBikeLabel("");
    setBikeMake("");
    setBikeModel("");
    setBikeColour("");
    setBikeFrameNumber("");
    setBikeSerialNumber("");
    setBikeRegistrationNumber("");
    setBikeRecordNotes("");
  };

  const beginInlineCustomerCreateFromSearch = () => {
    const draftName = trimmedCustomerSearch || newCustomerName.trim();
    setCreateCustomerInline(true);
    setNewCustomerName(draftName);
    setSelectedCustomer(null);
    setManualCustomerName("");
    setSelectedBikeId("");
    resetBikeDraft();
    setHighlightedCustomerOptionIndex(-1);
  };

  const selectExistingCustomer = (customer: CustomerRow) => {
    setSelectedCustomer(customer);
    setCreateCustomerInline(false);
    setManualCustomerName("");
    setSelectedBikeId("");
    resetBikeDraft();
    setHighlightedCustomerOptionIndex(-1);
  };

  const clearCustomerSelection = () => {
    setSelectedCustomer(null);
    setCreateCustomerInline(false);
    setNewCustomerName("");
    setNewCustomerEmail("");
    setNewCustomerPhone("");
    setManualCustomerName("");
    setSelectedBikeId("");
    setCustomerBikes([]);
    resetBikeDraft();
    setHighlightedCustomerOptionIndex(-1);
  };

  const selectBikeRecord = (bike: CustomerBikeRecord) => {
    setSelectedBikeId(bike.id);
    resetBikeDraft();
    setBikeDescription((current) => current.trim() || bike.displayName);
    setBikeSearchModalOpen(false);
  };

  const saveBikeDraft = () => {
    setSelectedBikeId("");
    setCreateBikeInline(true);
    setBikeDescription((current) => current.trim() || bikeDraftDisplayName);
    setBikeCreateModalOpen(false);
  };

  const formContent = (
    <form className={embedded ? "workshop-checkin-flow workshop-checkin-flow--embedded" : "page-shell"} onSubmit={submitCheckIn}>
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
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setHighlightedCustomerOptionIndex(-1);
                          return;
                        }

                        if (customerSearchOptionCount === 0) {
                          return;
                        }

                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setHighlightedCustomerOptionIndex((current) => (
                            current < 0 ? 0 : Math.min(current + 1, customerSearchOptionCount - 1)
                          ));
                          return;
                        }

                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setHighlightedCustomerOptionIndex((current) => (
                            current < 0 ? 0 : Math.max(current - 1, 0)
                          ));
                          return;
                        }

                        if (event.key !== "Enter" || highlightedCustomerOptionIndex < 0) {
                          return;
                        }

                        event.preventDefault();
                        if (highlightedCustomerOptionIndex < customerResults.length) {
                          selectExistingCustomer(customerResults[highlightedCustomerOptionIndex]);
                          return;
                        }

                        if (showInlineCreateCustomerOption) {
                          beginInlineCustomerCreateFromSearch();
                        }
                      }}
                      placeholder="name, phone, email"
                      aria-activedescendant={
                        highlightedCustomerOptionIndex >= 0
                          ? `workshop-checkin-customer-option-${highlightedCustomerOptionIndex}`
                          : undefined
                      }
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
                    <tbody role="listbox" aria-label="Customer search results">
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
                      ) : customerResults.map((customer, index) => (
                        <tr
                          key={customer.id}
                          id={`workshop-checkin-customer-option-${index}`}
                          ref={(element) => {
                            customerOptionRefs.current[index] = element;
                          }}
                          className={index === highlightedCustomerOptionIndex ? "workshop-checkin-search-result workshop-checkin-search-result--active" : undefined}
                          role="option"
                          aria-selected={index === highlightedCustomerOptionIndex}
                          onMouseEnter={() => setHighlightedCustomerOptionIndex(index)}
                        >
                          <td>{customer.name}</td>
                          <td>
                            <div>{customer.email || "-"}</div>
                            <div className="table-secondary">{customer.phone || "-"}</div>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => {
                                selectExistingCustomer(customer);
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

                {showInlineCreateCustomerOption ? (
                  <div
                    className={`restricted-panel info-panel workshop-checkin-create-customer-option${highlightedCustomerOptionIndex === customerResults.length ? " workshop-checkin-create-customer-option--active" : ""}`}
                    style={{ marginTop: "12px" }}
                    role="option"
                    aria-selected={highlightedCustomerOptionIndex === customerResults.length}
                  >
                    <div className="actions-inline" style={{ justifyContent: "space-between", gap: "12px" }}>
                      <div>
                        <strong>No exact customer match found.</strong>
                        <div className="table-secondary">Create a new customer directly from the name you just typed.</div>
                      </div>
                      <button
                        type="button"
                        className="primary"
                        id={`workshop-checkin-customer-option-${customerResults.length}`}
                        ref={(element) => {
                          customerOptionRefs.current[customerResults.length] = element;
                        }}
                        aria-selected={highlightedCustomerOptionIndex === customerResults.length}
                        onMouseEnter={() => setHighlightedCustomerOptionIndex(customerResults.length)}
                        onFocus={() => setHighlightedCustomerOptionIndex(customerResults.length)}
                        onClick={beginInlineCustomerCreateFromSearch}
                      >
                        Create new customer "{trimmedCustomerSearch}"
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="job-meta-grid" style={{ marginTop: "12px" }}>
                  <div>
                    <strong>Selected customer:</strong> {selectedCustomer?.name || "-"}
                  </div>
                  <div>
                    <strong>Manual intake name:</strong> {manualCustomerName || "-"}
                  </div>
                </div>

                {selectedCustomer ? (
                  <div className="actions-inline" style={{ marginTop: "12px" }}>
                    <button type="button" onClick={clearCustomerSelection}>
                      Change customer
                    </button>
                  </div>
                ) : null}

                <div className="actions-inline" style={{ marginTop: "12px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      clearCustomerSelection();
                    }}
                  >
                    Use walk-in/manual name
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      beginInlineCustomerCreateFromSearch();
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
                <div className="restricted-panel info-panel workshop-checkin-bike-picker">
                  <div className="workshop-checkin-bike-picker__header">
                    <div>
                      <strong>Bike record</strong>
                      <div className="table-secondary">
                        {loadingCustomerBikes
                          ? "Loading existing bike records..."
                          : selectedCustomer
                            ? `${customerBikes.length} bike record${customerBikes.length === 1 ? "" : "s"} available for ${selectedCustomer.name}.`
                            : "New customer details will be saved with the job; bike summary still drives workshop intake."}
                      </div>
                    </div>
                    <div className="actions-inline">
                      <button
                        type="button"
                        onClick={() => {
                          setBikeSearchText("");
                          setBikeSearchModalOpen(true);
                        }}
                        disabled={!selectedCustomer || loadingCustomerBikes}
                      >
                        Search/select bike
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => setBikeCreateModalOpen(true)}
                      >
                        Add new bike
                      </button>
                    </div>
                  </div>

                  {selectedBikeRecord ? (
                    <div className="workshop-checkin-bike-picker__selected">
                      <div>
                        <strong>{selectedBikeRecord.displayName}</strong>
                        <div className="table-secondary">
                          {selectedBikeRecord.notes || "Existing customer bike selected for this job."}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBikeId("");
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  ) : null}

                  {createBikeInline ? (
                    <div className="workshop-checkin-bike-picker__selected">
                      <div>
                        <strong>{bikeDraftDisplayName}</strong>
                        <div className="table-secondary">
                          New bike record will be created with this check-in.
                        </div>
                      </div>
                      <div className="actions-inline">
                        <button type="button" onClick={() => setBikeCreateModalOpen(true)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            resetBikeDraft();
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {!selectedBikeRecord && !createBikeInline ? (
                    <div className="table-secondary">
                      No bike record linked yet. Bike summary below will still be used operationally.
                    </div>
                  ) : null}
                </div>
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
                Problem / Work
                <textarea
                  value={problemWork}
                  onChange={(event) => setProblemWork(event.target.value)}
                  rows={4}
                  placeholder="What is wrong, what work is needed, or what the customer is asking for"
                />
              </label>
              <label>
                Additional notes
                <textarea
                  value={additionalNotes}
                  onChange={(event) => setAdditionalNotes(event.target.value)}
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
                  ? `${bikeDraftDisplayName} (new record will be created with this check-in)`
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
  );

  if (embedded) {
    return (
      <div className="workshop-checkin-modal-body">
        <section className="card workshop-checkin-modal-intro">
          <div className="card-header-row">
            <div>
              <h3>New Job</h3>
              <p className="muted-text">
                Capture customer, bike, and intake details without leaving the Workshop Operating Screen.
              </p>
            </div>
            {createdJobId ? <Link to={`/workshop/${createdJobId}`}>Open created job</Link> : null}
          </div>
          {renderStepIndicators(step)}
        </section>
        {formContent}
        {bikeSearchModalOpen ? (
          <div className="workshop-checkin-submodal-backdrop" onClick={() => setBikeSearchModalOpen(false)} aria-hidden="true">
            <aside
              className="workshop-os-modal workshop-checkin-submodal"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Search existing bike"
            >
              <div className="workshop-os-modal__header">
                <div className="workshop-os-drawer__header">
                  <div className="workshop-os-overlay-hero__title">
                    <p className="ui-page-eyebrow">Bike Search</p>
                    <h2>Select existing bike</h2>
                    <p className="table-secondary">Search linked bikes for the selected customer and return the record to intake.</p>
                  </div>
                  <button type="button" onClick={() => setBikeSearchModalOpen(false)} aria-label="Close bike search">
                    Close
                  </button>
                </div>
              </div>
              <div className="workshop-os-modal__content workshop-checkin-submodal__content">
                <label className="grow">
                  Search bikes
                  <input
                    value={bikeSearchText}
                    onChange={(event) => setBikeSearchText(event.target.value)}
                    placeholder="Search make, model, colour, serial, registration"
                  />
                </label>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Bike</th>
                        <th>Details</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomerBikes.length === 0 ? (
                        <tr>
                          <td colSpan={3}>
                            {loadingCustomerBikes
                              ? "Loading bikes..."
                              : bikeSearchText.trim()
                                ? "No customer bikes matched that search."
                                : "No saved bikes are available for this customer yet."}
                          </td>
                        </tr>
                      ) : filteredCustomerBikes.map((bike) => (
                        <tr key={bike.id}>
                          <td>{bike.displayName}</td>
                          <td>
                            <div>{bike.notes || bike.make || bike.model || "-"}</div>
                            <div className="table-secondary">{bike.registrationNumber || bike.serialNumber || bike.frameNumber || "-"}</div>
                          </td>
                          <td>
                            <button type="button" onClick={() => selectBikeRecord(bike)}>
                              Select
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </aside>
          </div>
        ) : null}
        {bikeCreateModalOpen ? (
          <div className="workshop-checkin-submodal-backdrop" onClick={() => setBikeCreateModalOpen(false)} aria-hidden="true">
            <aside
              className="workshop-os-modal workshop-checkin-submodal"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Add new bike"
            >
              <div className="workshop-os-modal__header">
                <div className="workshop-os-drawer__header">
                  <div className="workshop-os-overlay-hero__title">
                    <p className="ui-page-eyebrow">Bike Record</p>
                    <h2>Add new bike</h2>
                    <p className="table-secondary">Capture the bike record separately, then return it to the Bike & Intake step.</p>
                  </div>
                  <button type="button" onClick={() => setBikeCreateModalOpen(false)} aria-label="Close bike create">
                    Close
                  </button>
                </div>
              </div>
              <div className="workshop-os-modal__content workshop-checkin-submodal__content">
                <div className="job-meta-grid">
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
                <div className="restricted-panel info-panel">
                  <strong>Preview</strong>
                  <div className="table-secondary">{bikeDraftDisplayName}</div>
                </div>
              </div>
              <div className="workshop-os-modal__footer">
                <div className="workshop-os-modal__footer-message">
                  Bike summary will remain editable separately in the intake step.
                </div>
                <div className="workshop-os-modal__footer-actions">
                  <div className="actions-inline">
                    <button type="button" onClick={() => setBikeCreateModalOpen(false)}>
                      Cancel
                    </button>
                    <button type="button" className="primary" onClick={saveBikeDraft}>
                      Use bike in intake
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    );
  }

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

        {renderStepIndicators(step)}
      </section>

      {formContent}
    </div>
  );
};
