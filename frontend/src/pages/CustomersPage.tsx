import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { parseCombinedCustomerName } from "../utils/customerName";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
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

type LastActivityMap = Record<string, string>;

const newestDate = (dates: Array<string | null | undefined>) => {
  const validDates = dates
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value));

  if (validDates.length === 0) {
    return null;
  }

  return validDates.reduce((latest, current) => (current > latest ? current : latest));
};

export const CustomersPage = () => {
  const { success, error } = useToasts();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastActivityByCustomerId, setLastActivityByCustomerId] = useState<LastActivityMap>({});

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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

            const latest = newestDate([
              ...sales.sales.map((sale) => sale.completedAt || sale.createdAt),
              ...workshop.jobs.map((job) => job.updatedAt || job.createdAt),
            ]);

            return [
              customer.id,
              latest ? latest.toLocaleDateString() : "-",
            ] as const;
          } catch {
            return [customer.id, "-"] as const;
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
      });
      setName("");
      setEmail("");
      setPhone("");
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
    <div className="page-shell">
      <section className="card">
        <h1>Customers</h1>

        <div className="filter-row">
          <label className="grow">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="name, email, phone"
            />
          </label>
          <button type="button" onClick={() => void loadCustomers()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={4}>No customers found.</td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link to={`/customers/${customer.id}`}>{customer.name}</Link>
                    </td>
                    <td>{customer.email || "-"}</td>
                    <td>{customer.phone || "-"}</td>
                    <td>{lastActivityByCustomerId[customer.id] || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Create Customer</h2>
        <form className="filter-row" onSubmit={createCustomer}>
          <label className="grow">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Phone
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Creating..." : "Create"}
          </button>
        </form>
      </section>
    </div>
  );
};
