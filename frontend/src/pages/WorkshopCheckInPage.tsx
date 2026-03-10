import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";

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

const stepTitles = [
  "Customer",
  "Bike & Work",
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
  const [searchParams] = useSearchParams();
  const initialCustomerId = searchParams.get("customerId");

  const [step, setStep] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 250);
  const [customerResults, setCustomerResults] = useState<CustomerRow[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  const [manualCustomerName, setManualCustomerName] = useState("");
  const [createCustomerInline, setCreateCustomerInline] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const [bikeDescription, setBikeDescription] = useState("");
  const [issueSummary, setIssueSummary] = useState("");
  const [requestedWork, setRequestedWork] = useState("");
  const [intakeNotes, setIntakeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);

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
  }, [error, initialCustomerId]);

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

      const created = await apiPost<{ id: string }>("/api/workshop/jobs", {
        customerName: resolvedCustomerName,
        bikeDescription: bikeDescription.trim(),
        notes: checkInNotes || undefined,
        status: "BOOKED",
      });

      if (customerId) {
        await apiPatch(`/api/workshop/jobs/${encodeURIComponent(created.id)}/customer`, {
          customerId,
        });
      }

      setCreatedJobId(created.id);
      success("Workshop check-in created");
    } catch (submitError) {
      error(submitError instanceof Error ? submitError.message : "Failed to create workshop check-in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Check-In</h1>
            <p className="muted-text">
              Step-based internal intake flow for creating workshop jobs consistently from the counter.
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
                      <td colSpan={3}>{loadingCustomers ? "Searching..." : "No customer results yet."}</td>
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
                }}
              >
                Use manual name
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateCustomerInline(true);
                  setSelectedCustomer(null);
                  setManualCustomerName("");
                }}
              >
                Create customer inline
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
          </section>
        ) : null}

        {step === 1 ? (
          <section className="card">
            <h2>Bike & Requested Work</h2>
            <div className="job-meta-grid">
              <label>
                Bike description
                <input
                  value={bikeDescription}
                  onChange={(event) => setBikeDescription(event.target.value)}
                  placeholder="e.g. Trek road bike, blue, 56cm"
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
            <div className="job-meta-grid">
              <div><strong>Customer:</strong> {resolvedCustomerName}</div>
              <div><strong>Bike:</strong> {bikeDescription || "-"}</div>
            </div>
            <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
              <strong>Check-in summary</strong>
              <pre className="note-pre">{checkInNotes || "No additional notes captured."}</pre>
            </div>
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
