type SalesReceiptItem = {
  variantId: string | null;
  sku: string | null;
  name: string;
  qty: number;
  unitPricePence: number;
  lineTotalPence: number;
};

type SalesReceiptTender = {
  id: string;
  method: string;
  amountPence: number;
  createdAt: string;
};

type SalesReceiptPayment = {
  id: string;
  method: string;
  amountPence: number;
  status: string;
  providerRef: string | null;
  createdAt: string;
};

export type SalesReceiptData = {
  receiptNumber: string;
  issuedAt: string;
  saleId: string | null;
  refundId: string | null;
  type: "SALE" | "REFUND";
  shop: {
    name: string;
    address: string;
    vatNumber: string | null;
    logoUrl: string;
    uploadedLogoPath: string;
    preferredLogoUrl: string;
    footerText: string | null;
  };
  staff: {
    id: string | null;
    name: string | null;
  };
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  createdAt: string;
  completedAt: string | null;
  items: SalesReceiptItem[];
  totals: {
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
    changeDuePence: number;
  };
  tenders: SalesReceiptTender[];
  payments: SalesReceiptPayment[];
};

type SalesReceiptProps = {
  receipt: SalesReceiptData;
};

const moneyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "short",
  timeStyle: "short",
});

const formatMoney = (pence: number) => moneyFormatter.format(pence / 100);

const formatDateTime = (value: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return dateTimeFormatter.format(parsed);
};

const getPaymentSummary = (receipt: SalesReceiptData) => {
  if (receipt.tenders.length > 0) {
    return receipt.tenders.map((tender) => ({
      key: tender.id,
      label: tender.method.replaceAll("_", " "),
      amountPence: tender.amountPence,
    }));
  }

  return receipt.payments.map((payment) => ({
    key: payment.id,
    label: payment.method.replaceAll("_", " "),
    amountPence: payment.amountPence,
  }));
};

export const SalesReceipt = ({ receipt }: SalesReceiptProps) => {
  const paymentSummary = getPaymentSummary(receipt);
  const totalPaidPence = paymentSummary.reduce((sum, payment) => sum + payment.amountPence, 0);
  const saleReference = receipt.saleId ? receipt.saleId.slice(0, 8).toUpperCase() : null;
  const completedAt = formatDateTime(receipt.completedAt) ?? formatDateTime(receipt.issuedAt);
  const issuedAt = formatDateTime(receipt.issuedAt);

  return (
    <article className="sales-receipt" data-testid="sales-receipt">
      <header className="sales-receipt__header">
        {receipt.shop.preferredLogoUrl ? (
          <div className="sales-receipt__logo-wrap">
            <img
              className="sales-receipt__logo"
              src={receipt.shop.preferredLogoUrl}
              alt={`${receipt.shop.name} logo`}
            />
          </div>
        ) : null}
        <div className="sales-receipt__shop-name">{receipt.shop.name}</div>
        <div className="sales-receipt__shop-address">{receipt.shop.address}</div>
        {receipt.shop.vatNumber ? (
          <div className="sales-receipt__meta-line">VAT {receipt.shop.vatNumber}</div>
        ) : null}
      </header>

      <section className="sales-receipt__section sales-receipt__section--meta">
        <div className="sales-receipt__meta-grid">
          <div>
            <span className="sales-receipt__meta-label">Receipt</span>
            <strong>{receipt.receiptNumber}</strong>
          </div>
          {saleReference ? (
            <div>
              <span className="sales-receipt__meta-label">Sale</span>
              <strong>{saleReference}</strong>
            </div>
          ) : null}
          {completedAt ? (
            <div>
              <span className="sales-receipt__meta-label">Completed</span>
              <strong>{completedAt}</strong>
            </div>
          ) : null}
          {receipt.staff.name || receipt.staff.id ? (
            <div>
              <span className="sales-receipt__meta-label">Staff</span>
              <strong>{receipt.staff.name || receipt.staff.id}</strong>
            </div>
          ) : null}
          {issuedAt ? (
            <div>
              <span className="sales-receipt__meta-label">Issued</span>
              <strong>{issuedAt}</strong>
            </div>
          ) : null}
          {receipt.customer?.name ? (
            <div>
              <span className="sales-receipt__meta-label">Customer</span>
              <strong>{receipt.customer.name}</strong>
            </div>
          ) : null}
        </div>
      </section>

      <section className="sales-receipt__section">
        <div className="sales-receipt__divider" />
        <div className="sales-receipt__item-list">
          {receipt.items.map((item) => (
            <div key={`${item.variantId ?? item.sku ?? item.name}-${item.lineTotalPence}`} className="sales-receipt__item">
              <div className="sales-receipt__item-topline">
                <div className="sales-receipt__item-name">{item.name}</div>
                <div className="sales-receipt__item-line-total">{formatMoney(item.lineTotalPence)}</div>
              </div>
              <div className="sales-receipt__item-bottomline">
                <span>{item.qty} x {formatMoney(item.unitPricePence)}</span>
                {item.sku ? <span>SKU {item.sku}</span> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="sales-receipt__divider" />
      </section>

      <section className="sales-receipt__section sales-receipt__section--totals">
        <div className="sales-receipt__totals-row">
          <span>Subtotal</span>
          <strong>{formatMoney(receipt.totals.subtotalPence)}</strong>
        </div>
        {receipt.totals.taxPence > 0 ? (
          <div className="sales-receipt__totals-row">
            <span>VAT / Tax</span>
            <strong>{formatMoney(receipt.totals.taxPence)}</strong>
          </div>
        ) : null}
        <div className="sales-receipt__totals-row sales-receipt__totals-row--grand">
          <span>Total</span>
          <strong>{formatMoney(receipt.totals.totalPence)}</strong>
        </div>
        {totalPaidPence > 0 ? (
          <div className="sales-receipt__totals-row">
            <span>Paid</span>
            <strong>{formatMoney(totalPaidPence)}</strong>
          </div>
        ) : null}
        {receipt.totals.changeDuePence > 0 ? (
          <div className="sales-receipt__totals-row">
            <span>Change</span>
            <strong>{formatMoney(receipt.totals.changeDuePence)}</strong>
          </div>
        ) : null}
      </section>

      {paymentSummary.length > 0 ? (
        <section className="sales-receipt__section">
          <div className="sales-receipt__section-title">Payments</div>
          <div className="sales-receipt__payments">
            {paymentSummary.map((payment) => (
              <div key={payment.key} className="sales-receipt__payment-row">
                <span>{payment.label}</span>
                <strong>{formatMoney(payment.amountPence)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="sales-receipt__footer">
        {receipt.shop.footerText ? (
          <p>{receipt.shop.footerText}</p>
        ) : (
          <p>Thank you for shopping with us.</p>
        )}
      </footer>
    </article>
  );
};
