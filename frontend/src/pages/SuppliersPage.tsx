import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type SupplierListResponse = {
  suppliers: Supplier[];
};

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

export const SuppliersPage = () => {
  const { user } = useAuth();
  const { success, error } = useToasts();
  const canManage = isManagerPlus(user?.role);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) {
      params.set("query", debouncedSearch.trim());
    }
    return params.toString();
  }, [debouncedSearch]);

  const loadSuppliers = async () => {
    setLoading(true);
    try {
      const path = query ? `/api/suppliers?${query}` : "/api/suppliers";
      const payload = await apiGet<SupplierListResponse>(path);
      setSuppliers(payload.suppliers || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load suppliers";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const createSupplier = async (event: FormEvent) => {
    event.preventDefault();

    if (!canManage) {
      error("Supplier creation requires MANAGER+.");
      return;
    }

    setSubmitting(true);
    try {
      await apiPost("/api/suppliers", {
        name,
        email: email || undefined,
        phone: phone || undefined,
        notes: notes || undefined,
      });
      setName("");
      setEmail("");
      setPhone("");
      setNotes("");
      success("Supplier created");
      await loadSuppliers();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Failed to create supplier";
      error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Suppliers</h1>
            <p className="muted-text">Supplier directory for purchasing and receiving workflows.</p>
          </div>
          <div className="actions-inline">
            <Link to="/purchasing" className="button-link">Open Purchasing</Link>
            <button type="button" onClick={() => void loadSuppliers()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label className="grow">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="supplier name, email, phone"
            />
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Notes</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={5}>{loading ? "Loading suppliers..." : "No suppliers found."}</td>
                </tr>
              ) : (
                suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <div className="table-primary">{supplier.name}</div>
                      <div className="table-secondary mono-text">{supplier.id.slice(0, 8)}</div>
                    </td>
                    <td>{supplier.email || "-"}</td>
                    <td>{supplier.phone || "-"}</td>
                    <td>{supplier.notes || "-"}</td>
                    <td>{new Date(supplier.updatedAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Create Supplier</h2>
            <p className="muted-text">Available to MANAGER+ only.</p>
          </div>
        </div>

        {!canManage ? (
          <div className="restricted-panel">You can view suppliers, but creating suppliers requires MANAGER+.</div>
        ) : (
          <form className="inventory-adjustment-form" onSubmit={createSupplier}>
            <label>
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
            <label>
              Notes
              <input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <div className="actions-inline">
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? "Creating..." : "Create Supplier"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
};
