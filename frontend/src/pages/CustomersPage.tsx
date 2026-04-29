import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { parseCombinedCustomerName } from "../utils/customerName";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type CustomerResponse = {
  customers: Customer[];
};

type SalesHistory = {
  sales: Array<{ completedAt: string | null; createdAt: string }>;
};

type WorkshopHistory = {
  jobs: Array<{ updatedAt: string; createdAt: string }>;
};

type LastActivity = {
  label: string;
  kind: "sale" | "workshop" | "none" | "checking";
};

type LastActivityMap = Record<string, LastActivity>;

type CustomerDirectoryFilter = "all" | "recent" | "missing-contact" | "missing-postcode";

const EMPTY_ACTIVITY: LastActivity = { label: "No activity", kind: "none" };
const CHECKING_ACTIVITY: LastActivity = { label: "Checking...", kind: "checking" };

const formatActivityDate = (date: Date) => date.toLocaleDateString("en-GB");

const newestDate = (dates: Array<string | null | undefined>) => {
  const validDates = dates
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));

  if (validDates.length === 0) {
    return null;
  }

  return validDates.reduce((latest, current) => (current > latest ? current : latest));
};

const hasContactGap = (customer: Customer) => !customer.email || !customer.phone;

const hasPostcodeGap = (customer: Customer) => !customer.postcode;

const buildQualityBadges = (customer: Customer) => {
  const badges: string[] = [];
  if (!customer.email) {
    badges.push("No email");
  }
  if (!customer.phone) {
    badges.push("No phone");
  }
  if (!customer.postcode) {
    badges.push("No postcode");
  }
  return badges;
};

export const CustomersPage = () => {
  const { success, error } = useToasts();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastActivityByCustomerId, setLastActivityByCustomerId] = useState<LastActivityMap>({});
  const [activeFilter, setActiveFilter] = useState<CustomerDirectoryFilter>("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [postcode, setPostcode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("take", "50");
    if (debouncedSearch.trim()) {
      params.set("query", debouncedSearch.trim());
    }
    return params.toString();
  }, [debouncedSearch]);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<CustomerResponse>(`/api/customers?${query}`);
      setCustomers(payload.customers || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load customers";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (customers.length === 0) {
      setLastActivityByCustomerId({});
      return;
    }

    let cancelled = false;

    const loadLastActivity = async () => {
      const entries = await Promise.all(
        customers.map(async (customer) => {
          try {
            const [sales, workshop] = await Promise.all([
              apiGet<SalesHistory>(`/api/customers/${encodeURIComponent(customer.id)}/sales`),
              apiGet<WorkshopHistory>(`/api/customers/${encodeURIComponent(customer.id)}/workshop-jobs`),
            ]);

            const latestSale = newestDate(sales.sales.map((sale) => sale.completedAt || sale.createdAt));
            const latestWorkshop = newestDate(workshop.jobs.map((job) => job.updatedAt || job.createdAt));

            if (latestSale && (!latestWorkshop || latestSale >= latestWorkshop)) {
              return [
                customer.id,
                { label: `Sale ${formatActivityDate(latestSale)}`, kind: "sale" },
              ] as const;
            }

            if (latestWorkshop) {
              return [
                customer.id,
                { label: `Workshop ${formatActivityDate(latestWorkshop)}`, kind: "workshop" },
              ] as const;
            }

            return [customer.id, EMPTY_ACTIVITY] as const;
          } catch {
            return [customer.id, EMPTY_ACTIVITY] as const;
          }
        }),
      );

      if (!cancelled) {
        setLastActivityByCustomerId(Object.fromEntries(entries));
      }
    };

    void loadLastActivity();

    return () => {
      cancelled = true;
    };
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) => {
      const activity = lastActivityByCustomerId[customer.id];
      if (activeFilter === "recent") {
        return activity?.kind === "sale" || activity?.kind === "workshop";
      }
      if (activeFilter === "missing-contact") {
        return hasContactGap(customer);
      }
      if (activeFilter === "missing-postcode") {
        return hasPostcodeGap(customer);
      }
      return true;
    });
  }, [activeFilter, customers, lastActivityByCustomerId]);

  const filterOptions = useMemo(
    () => [
      { key: "all" as const, label: "All", count: customers.length },
      {
        key: "recent" as const,
        label: "Recent",
        count: customers.filter((customer) => {
          const activity = lastActivityByCustomerId[customer.id];
          return activity?.kind === "sale" || activity?.kind === "workshop";
        }).length,
      },
      {
        key: "missing-contact" as const,
        label: "Needs contact",
        count: customers.filter(hasContactGap).length,
      },
      {
        key: "missing-postcode" as const,
        label: "No postcode",
        count: customers.filter(hasPostcodeGap).length,
      },
    ],
    [customers, lastActivityByCustomerId],
  );

  const openCustomer = (customerId: string) => {
    navigate(`/customers/${customerId}`);
  };

  const createCustomer = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const parsedName = parseCombinedCustomerName(name);
      await apiPost("/api/customers", {
        firstName: parsedName.firstName,
        lastName: parsedName.lastName || undefined,
        email: email || undefined,
        phone: phone || undefined,
        postcode: postcode || undefined,
      });
      setName("");
      setEmail("");
      setPhone("");
      setPostcode("");
      setCreateModalOpen(false);
      success("Customer created");
      await loadCustomers();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Failed to create customer";
      error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell customer-directory-page-shell">
      <section className="card customer-directory-shell-card">
        <div className="customer-directory-header">
          <div>
            <h1>Customers</h1>
          </div>
          <button type="button" className="primary customer-directory-create-button" onClick={() => setCreateModalOpen(true)}>
            Create customer
          </button>
        </div>

        <div className="customer-directory-summary-grid">
          <button type="button" className="customer-directory-summary-card customer-directory-summary-card--highlight" onClick={() => setActiveFilter("all")}>
            <span>Total records</span>
            <strong>{customers.length}</strong>
          </button>
          <button type="button" className="customer-directory-summary-card" onClick={() => setActiveFilter("recent")}>
            <span>Recently active</span>
            <strong>{filterOptions.find((option) => option.key === "recent")?.count ?? 0}</strong>
          </button>
          <button type="button" className="customer-directory-summary-card" onClick={() => setActiveFilter("missing-contact")}>
            <span>Needs contact</span>
            <strong>{filterOptions.find((option) => option.key === "missing-contact")?.count ?? 0}</strong>
          </button>
          <button type="button" className="customer-directory-summary-card" onClick={() => setActiveFilter("missing-postcode")}>
            <span>No postcode</span>
            <strong>{filterOptions.find((option) => option.key === "missing-postcode")?.count ?? 0}</strong>
          </button>
        </div>

        <div className="customer-directory-toolbar">
          <label className="customer-directory-search">
            <span>Search customers</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="name, email, phone, postcode"
            />
          </label>
          <button type="button" onClick={() => void loadCustomers()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="customer-directory-filter-tabs" aria-label="Customer filters">
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`customer-directory-filter-tab${activeFilter === option.key ? " customer-directory-filter-tab--active" : ""}`}
              onClick={() => setActiveFilter(option.key)}
            >
              <span>{option.label}</span>
              <strong>{option.count}</strong>
            </button>
          ))}
        </div>

        <div className="customer-directory-table-wrap">
          <table className="customer-directory-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Address</th>
                <th>Last activity</th>
                <th>Data</th>
                <th aria-label="Profile action" />
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="customer-directory-empty">
                      {loading ? "Loading customers..." : "No customers match this view."}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => {
                  const activity = lastActivityByCustomerId[customer.id] ?? CHECKING_ACTIVITY;
                  const qualityBadges = buildQualityBadges(customer);

                  return (
                    <tr
                      key={customer.id}
                      className="customer-directory-row"
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a, button, input")) {
                          return;
                        }
                        openCustomer(customer.id);
                      }}
                    >
                      <td>
                        <Link to={`/customers/${customer.id}`} className="customer-directory-name-link">
                          {customer.name}
                        </Link>
                        {customer.notes ? <small>Notes on file</small> : null}
                      </td>
                      <td>
                        <div className="customer-directory-contact-stack">
                          <span className={customer.email ? "" : "customer-directory-muted"}>
                            {customer.email || "No email"}
                          </span>
                          <span className={customer.phone ? "" : "customer-directory-muted"}>
                            {customer.phone || "No phone"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={customer.postcode ? "customer-directory-postcode" : "customer-directory-muted"}>
                          {customer.postcode || "No postcode"}
                        </span>
                      </td>
                      <td>
                        <span className={`customer-directory-activity customer-directory-activity--${activity.kind}`}>
                          {activity.label}
                        </span>
                      </td>
                      <td>
                        <div className="customer-directory-badges">
                          {qualityBadges.length === 0 ? (
                            <span className="customer-directory-badge customer-directory-badge--ready">Complete</span>
                          ) : (
                            qualityBadges.map((badge) => (
                              <span key={badge} className="customer-directory-badge">
                                {badge}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        <Link to={`/customers/${customer.id}`} className="button-link button-link-compact">
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {createModalOpen ? (
        <div className="customer-directory-overlay" role="presentation" onClick={() => setCreateModalOpen(false)}>
          <form
            className="customer-directory-modal"
            onSubmit={createCustomer}
            onClick={(event) => event.stopPropagation()}
            aria-labelledby="create-customer-title"
          >
            <div className="customer-directory-modal__header">
              <div>
                <span className="bike-service-profile__eyebrow">New customer</span>
                <h2 id="create-customer-title">Create customer</h2>
              </div>
              <button type="button" onClick={() => setCreateModalOpen(false)} disabled={submitting}>
                Cancel
              </button>
            </div>

            <div className="customer-directory-modal__grid">
              <label className="customer-directory-modal__wide">
                <span>Name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
              </label>
              <label>
                <span>Email</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label>
                <span>Phone</span>
                <input value={phone} onChange={(event) => setPhone(event.target.value)} />
              </label>
              <label>
                <span>Postcode</span>
                <input value={postcode} onChange={(event) => setPostcode(event.target.value)} />
              </label>
            </div>

            <div className="customer-directory-modal__actions">
              <button type="submit" className="primary" disabled={submitting || !name.trim()}>
                {submitting ? "Creating..." : "Create customer"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
};
