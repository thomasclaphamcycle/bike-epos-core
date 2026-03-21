import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPatch } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import {
  workshopExecutionStatusClass,
  workshopExecutionStatusLabel,
  workshopRawStatusLabel,
} from "../features/workshop/status";
import { toBackendUrl } from "../utils/backendUrl";

const ACTIVE_SALE_KEY = "corepos.activeSaleId";

type Customer = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type CustomerSales = {
  sales: Array<{
    id: string;
    totalPence: number;
    createdAt: string;
    completedAt: string | null;
    receiptNumber: string | null;
  }>;
};

type CustomerWorkshopJob = {
  id: string;
  bikeId: string | null;
  status: string;
  rawStatus: string;
  bikeDescription: string | null;
  notes: string | null;
  scheduledDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type CustomerWorkshopJobs = {
  jobs?: CustomerWorkshopJob[];
  workshopJobs?: CustomerWorkshopJob[];
};

type CustomerBikeRecord = {
  id: string;
  label: string | null;
  make: string | null;
  model: string | null;
  colour: string | null;
  frameNumber: string | null;
  serialNumber: string | null;
  registrationNumber: string | null;
  notes: string | null;
  displayName: string;
  serviceSummary: {
    linkedJobCount: number;
    openJobCount: number;
    completedJobCount: number;
    firstJobAt: string | null;
    latestJobAt: string | null;
    latestCompletedAt: string | null;
  };
};

type CustomerBikesResponse = {
  bikes: CustomerBikeRecord[];
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatOptionalDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "-";

export const CustomerProfilePage = () => {
  const { id } = useParams<{ id: string }>();
  const { success, error } = useToasts();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<CustomerSales["sales"]>([]);
  const [jobs, setJobs] = useState<CustomerWorkshopJob[]>([]);
  const [bikes, setBikes] = useState<CustomerBikeRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const activeSaleId = useMemo(() => localStorage.getItem(ACTIVE_SALE_KEY), []);

  const loadProfile = async () => {
    if (!id) {
      return;
    }

    setLoading(true);
    try {
      const [customerPayload, salesPayload, jobsPayload, bikesPayload] = await Promise.all([
        apiGet<Customer>(`/api/customers/${encodeURIComponent(id)}`),
        apiGet<CustomerSales>(`/api/customers/${encodeURIComponent(id)}/sales`),
        apiGet<CustomerWorkshopJobs>(`/api/customers/${encodeURIComponent(id)}/workshop-jobs`),
        apiGet<CustomerBikesResponse>(`/api/customers/${encodeURIComponent(id)}/bikes`),
      ]);
      setCustomer(customerPayload);
      setSales(salesPayload.sales || []);
      setJobs(jobsPayload.workshopJobs || jobsPayload.jobs || []);
      setBikes(bikesPayload.bikes || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load customer profile";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const attachToActiveSale = async () => {
    if (!id || !activeSaleId) {
      error("No active POS sale found.");
      return;
    }

    try {
      await apiPatch(`/api/sales/${encodeURIComponent(activeSaleId)}/customer`, {
        customerId: id,
      });
      success(`Customer attached to active sale ${activeSaleId.slice(0, 8)}.`);
    } catch (attachError) {
      const message = attachError instanceof Error ? attachError.message : "Failed to attach customer";
      error(message);
    }
  };

  if (!id) {
    return <div className="page-shell"><p>Missing customer id.</p></div>;
  }

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <h1>Customer Profile</h1>
          <Link to="/customers">Back to Customers</Link>
        </div>

        {loading ? <p>Loading...</p> : null}

        {customer ? (
          <>
            <div className="job-meta-grid">
              <div><strong>Name:</strong> {customer.name}</div>
              <div><strong>Email:</strong> {customer.email || "-"}</div>
              <div><strong>Phone:</strong> {customer.phone || "-"}</div>
              <div><strong>Notes:</strong> {customer.notes || "-"}</div>
            </div>

            <div className="actions-inline" style={{ marginTop: "10px" }}>
              <button type="button" onClick={attachToActiveSale} disabled={!activeSaleId}>
                Attach To Active POS Sale
              </button>
              <Link to={`/customers/${customer.id}/timeline`} className="button-link">
                View Timeline
              </Link>
              <span className="muted-text">
                {activeSaleId ? `Active sale: ${activeSaleId.slice(0, 8)}` : "No active POS sale in this browser."}
              </span>
            </div>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Bike Records</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bike</th>
                <th>Identity</th>
                <th>Linked Jobs</th>
                <th>Latest Linked Service</th>
              </tr>
            </thead>
            <tbody>
              {bikes.length === 0 ? (
                <tr>
                  <td colSpan={4}>No bike records linked to this customer yet.</td>
                </tr>
              ) : (
                bikes.map((bike) => (
                  <tr key={bike.id}>
                    <td>
                      <div className="table-primary">
                        <Link to={`/customers/bikes/${bike.id}`}>{bike.displayName}</Link>
                      </div>
                      <div className="table-secondary">
                        {bike.notes || "Reusable bike record for service history"}
                      </div>
                    </td>
                    <td>
                      {[bike.make, bike.model].filter(Boolean).join(" ") || "-"}
                      <div className="table-secondary">
                        {bike.registrationNumber || bike.frameNumber || bike.serialNumber || "No identifier recorded"}
                      </div>
                    </td>
                    <td>
                      {bike.serviceSummary.linkedJobCount}
                      <div className="table-secondary">
                        {bike.serviceSummary.openJobCount} open / {bike.serviceSummary.completedJobCount} completed
                      </div>
                    </td>
                    <td>{formatOptionalDateTime(bike.serviceSummary.latestJobAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Sales History</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Total</th>
                <th>Completed</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={4}>No sales found.</td>
                </tr>
              ) : (
                sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.id.slice(0, 8)}</td>
                    <td>{formatMoney(sale.totalPence)}</td>
                    <td>{sale.completedAt ? new Date(sale.completedAt).toLocaleString() : "-"}</td>
                    <td>
                      {sale.receiptNumber ? (
                        <a href={toBackendUrl(`/r/${encodeURIComponent(sale.receiptNumber)}`)} target="_blank" rel="noreferrer">
                          View Receipt
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="actions-inline" style={{ marginTop: "10px" }}>
          <Link to={`/customers/${id}/timeline`}>Open full timeline</Link>
        </div>
      </section>

      <section className="card">
        <h2>Workshop History</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Bike</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={4}>No workshop jobs found.</td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link>
                    </td>
                    <td>
                      <span className={workshopExecutionStatusClass(job.status, job.rawStatus)}>
                        {workshopExecutionStatusLabel(job.status)}
                      </span>
                      <div className="table-secondary">{workshopRawStatusLabel(job.rawStatus)}</div>
                    </td>
                    <td>
                      {job.bikeId ? (
                        <Link to={`/customers/bikes/${job.bikeId}`}>{job.bikeDescription || "Linked bike"}</Link>
                      ) : (
                        job.bikeDescription || "-"
                      )}
                    </td>
                    <td>{new Date(job.updatedAt).toLocaleString()}</td>
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
