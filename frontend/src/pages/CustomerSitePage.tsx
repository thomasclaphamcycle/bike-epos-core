import { Link } from "react-router-dom";

type CustomerSiteVariant = "home" | "services" | "workshop" | "contact";

const contentByVariant: Record<
  CustomerSiteVariant,
  {
    eyebrow: string;
    title: string;
    intro: string;
    highlights: string[];
    primaryCta: { label: string; to: string };
    secondaryCta: { label: string; to: string };
  }
> = {
  home: {
    eyebrow: "CorePOS Customer Site",
    title: "Bike shop website foundation for services, workshop bookings, and store information.",
    intro:
      "This public-facing starter gives CorePOS a practical brochure surface for store details, workshop messaging, and future online booking expansion without changing the staff app.",
    highlights: [
      "Promote workshop repairs, tune-ups, and same-day triage.",
      "Show clear store information before the first pilot.",
      "Keep a simple structure ready for future booking and marketing growth.",
    ],
    primaryCta: { label: "View Services", to: "/site/services" },
    secondaryCta: { label: "Workshop Repairs", to: "/site/workshop" },
  },
  services: {
    eyebrow: "Services",
    title: "Lay out the retail and repair services customers ask about first.",
    intro:
      "This foundation page explains the practical services a local bike shop usually needs to present first: safety checks, repairs, tune-ups, and accessory fitting.",
    highlights: [
      "Safety checks and commuter-bike repair triage.",
      "Routine workshop servicing for road, commuter, and family bikes.",
      "Parts fitting, brake work, drivetrain service, and collection-ready updates.",
    ],
    primaryCta: { label: "Contact The Shop", to: "/site/contact" },
    secondaryCta: { label: "See Workshop Flow", to: "/site/workshop" },
  },
  workshop: {
    eyebrow: "Workshop",
    title: "Explain the repair journey before the customer reaches the counter.",
    intro:
      "Use this page to show a clear intake-to-collection flow: check-in, approval, parts updates, and collection once the bike is ready.",
    highlights: [
      "Simple repair intake and estimate approval flow.",
      "Parts-delay communication and realistic collection updates.",
      "Collection handoff that already matches the CorePOS workshop workflow.",
    ],
    primaryCta: { label: "Contact The Workshop", to: "/site/contact" },
    secondaryCta: { label: "Back To Services", to: "/site/services" },
  },
  contact: {
    eyebrow: "Visit And Contact",
    title: "Store information and contact details for a real pilot shop.",
    intro:
      "Keep the first pilot site useful: opening hours, phone, email, service drop-off guidance, and a clear path back into the staff-facing login when needed.",
    highlights: [
      "Phone and email contact points for booking and service updates.",
      "Opening hours and collection expectations in one place.",
      "A practical base for future maps, contact forms, and online booking requests.",
    ],
    primaryCta: { label: "Return To Login", to: "/login" },
    secondaryCta: { label: "Browse Services", to: "/site/services" },
  },
};

const navigation = [
  { label: "Overview", to: "/site" },
  { label: "Services", to: "/site/services" },
  { label: "Workshop", to: "/site/workshop" },
  { label: "Contact", to: "/site/contact" },
];

export const CustomerSitePage = ({ variant }: { variant: CustomerSiteVariant }) => {
  const content = contentByVariant[variant];
  const currentPath = variant === "home" ? "/site" : `/site/${variant}`;

  return (
    <div className="customer-site-shell">
      <section className="customer-site-hero">
        <div className="customer-site-topbar">
          <Link to="/site" className="customer-site-brand">
            CorePOS Bikes
          </Link>
          <nav className="customer-site-nav" aria-label="Customer site navigation">
            {navigation.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={item.to === currentPath ? "customer-site-nav-link active" : "customer-site-nav-link"}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="customer-site-hero-grid">
          <div className="customer-site-copy">
            <span className="customer-site-eyebrow">{content.eyebrow}</span>
            <h1>{content.title}</h1>
            <p>{content.intro}</p>
            <div className="actions-inline">
              <Link className="button-link" to={content.primaryCta.to}>
                {content.primaryCta.label}
              </Link>
              <Link className="button-link button-link-compact" to={content.secondaryCta.to}>
                {content.secondaryCta.label}
              </Link>
            </div>
          </div>

          <aside className="customer-site-info-card">
            <strong>Store snapshot</strong>
            <ul>
              <li>Open Tue-Sat, 9:00-17:30</li>
              <li>Workshop drop-off before 15:00 for same-day triage</li>
              <li>Collection updates run through the existing CorePOS workshop flow</li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="customer-site-section">
        <div className="customer-site-card-grid">
          {content.highlights.map((item) => (
            <article key={item} className="customer-site-card">
              <h2>{item}</h2>
              <p>
                This is intentionally lightweight brochure scaffolding so the pilot can explain services clearly before
                deeper customer booking or marketing integrations are added.
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="customer-site-section customer-site-section-muted">
        <div className="customer-site-dual-grid">
          <article className="customer-site-card">
            <h2>Planned customer expansion</h2>
            <p>
              Future booking forms, service request capture, marketing pages, and store updates can grow on top of this
              structure without disturbing the staff-facing POS and workshop app.
            </p>
          </article>
          <article className="customer-site-card">
            <h2>Contact foundation</h2>
            <p>Call 01234 567890 or email hello@corepos-bikes.local for repairs, bike collection queries, and service planning.</p>
            <p>Unit 4, Riverside Yard, Openfield Road</p>
          </article>
        </div>
      </section>
    </div>
  );
};
