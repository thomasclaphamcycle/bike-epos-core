import type { AppConfig } from "../../config/appConfig";

type SaleDocumentItem = {
  id: string;
  saleId: string;
  variantId: string;
  sku: string;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPricePence: number;
  lineTotalPence: number;
};

type SaleDocumentTender = {
  id: string;
  saleId: string;
  method: string;
  amountPence: number;
  createdAt: string;
  createdByStaffId: string | null;
};

type SaleDocumentPayment = {
  id: string;
  saleId: string;
  method: string;
  amountPence: number;
  providerRef: string | null;
  createdAt: string;
};

export type SalesInvoiceData = {
  sale: {
    id: string;
    basketId: string;
    exchangeFromSaleId: string | null;
    locationId: string;
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
    changeDuePence: number;
    createdAt: string;
    completedAt: string | null;
    receiptNumber: string | null;
    createdByStaff: {
      id: string;
      username: string;
      name: string | null;
    } | null;
    customer: {
      id: string;
      name: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
    } | null;
  };
  saleItems: SaleDocumentItem[];
  payment: SaleDocumentPayment | null;
  tenders: SaleDocumentTender[];
  tenderSummary: {
    totalPence: number;
    tenderedPence: number;
    remainingPence: number;
    changeDuePence: number;
    cashTenderedPence: number;
  };
};

type SalesInvoiceDocumentProps = {
  sale: SalesInvoiceData;
  appConfig: AppConfig;
  receiptNumber: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const moneyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

const formatMoney = (valuePence: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(valuePence / 100);
  } catch {
    return moneyFormatter.format(valuePence / 100);
  }
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
};

const buildStoreAddressLines = (store: AppConfig["store"]) => {
  return [
    store.addressLine1,
    store.addressLine2,
    [store.city, store.region].filter(Boolean).join(", "),
    [store.postcode, store.country].filter(Boolean).join(" · "),
  ].map((line) => line.trim()).filter(Boolean);
};

const buildCustomerContactLines = (sale: SalesInvoiceData["sale"]) => {
  const customer = sale.customer;
  if (!customer) {
    return ["Walk-in customer"];
  }

  return [
    customer.name,
    customer.email ?? "",
    customer.phone ?? "",
  ].map((line) => line.trim()).filter(Boolean);
};

const getPaymentLines = (sale: SalesInvoiceData) => {
  if (sale.tenders.length > 0) {
    return sale.tenders.map((tender) => ({
      key: tender.id,
      label: tender.method.replaceAll("_", " "),
      amountPence: tender.amountPence,
      detail: formatDateTime(tender.createdAt),
    }));
  }

  if (sale.payment) {
    return [{
      key: sale.payment.id,
      label: sale.payment.method.replaceAll("_", " "),
      amountPence: sale.payment.amountPence,
      detail: formatDateTime(sale.payment.createdAt),
    }];
  }

  return [];
};

const getSaleLineName = (item: SaleDocumentItem) =>
  item.variantName && item.variantName.trim().length > 0
    ? `${item.productName} · ${item.variantName.trim()}`
    : item.productName;

const getStaffName = (sale: SalesInvoiceData["sale"]) =>
  sale.createdByStaff?.name?.trim() || sale.createdByStaff?.username || "-";

export const SalesInvoiceDocument = ({
  sale,
  appConfig,
  receiptNumber,
}: SalesInvoiceDocumentProps) => {
  const storeAddressLines = buildStoreAddressLines(appConfig.store);
  const customerLines = buildCustomerContactLines(sale.sale);
  const paymentLines = getPaymentLines(sale);
  const documentCurrency = appConfig.store.defaultCurrency || "GBP";
  const completedAt = formatDateTime(sale.sale.completedAt);
  const createdAt = formatDateTime(sale.sale.createdAt);
  const documentNumber = receiptNumber || sale.sale.receiptNumber || sale.sale.id.slice(0, 8).toUpperCase();
  const logoUrl = appConfig.store.preferredLogoUrl || "";

  return (
    <article className="sales-invoice-document" data-testid="sales-invoice-document">
      <header className="sales-invoice-document__header">
        <div className="sales-invoice-document__brand">
          {logoUrl ? (
            <div className="sales-invoice-document__logo-wrap">
              <img
                className="sales-invoice-document__logo"
                src={logoUrl}
                alt={`${appConfig.store.name} logo`}
              />
            </div>
          ) : null}
          <div className="sales-invoice-document__brand-copy">
            <h1>{appConfig.store.businessName || appConfig.store.name}</h1>
            {storeAddressLines.map((line) => (
              <div key={line} className="sales-invoice-document__muted-line">{line}</div>
            ))}
            {appConfig.store.email ? (
              <div className="sales-invoice-document__muted-line">{appConfig.store.email}</div>
            ) : null}
            {appConfig.store.phone ? (
              <div className="sales-invoice-document__muted-line">{appConfig.store.phone}</div>
            ) : null}
          </div>
        </div>

        <div className="sales-invoice-document__meta-card">
          <div className="sales-invoice-document__eyebrow">A4 Document Print</div>
          <h2>Sales Invoice</h2>
          <dl className="sales-invoice-document__meta-list">
            <div>
              <dt>Document no.</dt>
              <dd>{documentNumber}</dd>
            </div>
            <div>
              <dt>Sale ref</dt>
              <dd className="mono-text">{sale.sale.id.slice(0, 8).toUpperCase()}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{completedAt}</dd>
            </div>
            <div>
              <dt>Prepared by</dt>
              <dd>{getStaffName(sale.sale)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <section className="sales-invoice-document__summary-grid">
        <section className="sales-invoice-document__panel">
          <div className="sales-invoice-document__panel-label">Bill to</div>
          {customerLines.map((line) => (
            <div key={line} className="sales-invoice-document__panel-line">{line}</div>
          ))}
        </section>

        <section className="sales-invoice-document__panel">
          <div className="sales-invoice-document__panel-label">Sale details</div>
          <div className="sales-invoice-document__panel-line">
            <strong>Created</strong> {createdAt}
          </div>
          <div className="sales-invoice-document__panel-line">
            <strong>Status</strong> {sale.sale.completedAt ? "Completed" : "Draft"}
          </div>
          <div className="sales-invoice-document__panel-line">
            <strong>Customer</strong> {sale.sale.customer?.name || "Walk-in"}
          </div>
        </section>
      </section>

      <section className="sales-invoice-document__table-section">
        <table className="sales-invoice-document__table">
          <thead>
            <tr>
              <th>Description</th>
              <th>SKU</th>
              <th className="sales-invoice-document__numeric">Qty</th>
              <th className="sales-invoice-document__numeric">Unit</th>
              <th className="sales-invoice-document__numeric">Line total</th>
            </tr>
          </thead>
          <tbody>
            {sale.saleItems.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="sales-invoice-document__table-primary">{getSaleLineName(item)}</div>
                </td>
                <td className="mono-text">{item.sku}</td>
                <td className="sales-invoice-document__numeric">{item.quantity}</td>
                <td className="sales-invoice-document__numeric">{formatMoney(item.unitPricePence, documentCurrency)}</td>
                <td className="sales-invoice-document__numeric">{formatMoney(item.lineTotalPence, documentCurrency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sales-invoice-document__footer-grid">
        <section className="sales-invoice-document__panel">
          <div className="sales-invoice-document__panel-label">Payment summary</div>
          {paymentLines.length > 0 ? paymentLines.map((payment) => (
            <div key={payment.key} className="sales-invoice-document__payment-row">
              <div>
                <strong>{payment.label}</strong>
                <div className="sales-invoice-document__muted-line">{payment.detail}</div>
              </div>
              <div>{formatMoney(payment.amountPence, documentCurrency)}</div>
            </div>
          )) : (
            <div className="sales-invoice-document__muted-line">No tender information recorded.</div>
          )}
        </section>

        <section className="sales-invoice-document__totals-card">
          <div className="sales-invoice-document__totals-row">
            <span>Subtotal</span>
            <strong>{formatMoney(sale.sale.subtotalPence, documentCurrency)}</strong>
          </div>
          {sale.sale.taxPence > 0 ? (
            <div className="sales-invoice-document__totals-row">
              <span>VAT / Tax</span>
              <strong>{formatMoney(sale.sale.taxPence, documentCurrency)}</strong>
            </div>
          ) : null}
          <div className="sales-invoice-document__totals-row sales-invoice-document__totals-row--grand">
            <span>Total</span>
            <strong>{formatMoney(sale.sale.totalPence, documentCurrency)}</strong>
          </div>
          {sale.tenderSummary.tenderedPence > 0 ? (
            <div className="sales-invoice-document__totals-row">
              <span>Paid</span>
              <strong>{formatMoney(sale.tenderSummary.tenderedPence, documentCurrency)}</strong>
            </div>
          ) : null}
          {sale.tenderSummary.changeDuePence > 0 ? (
            <div className="sales-invoice-document__totals-row">
              <span>Change due</span>
              <strong>{formatMoney(sale.tenderSummary.changeDuePence, documentCurrency)}</strong>
            </div>
          ) : null}
        </section>
      </section>

      <footer className="sales-invoice-document__footer-note">
        {appConfig.store.footerText || "Printed from CorePOS document print lane."}
      </footer>
    </article>
  );
};
