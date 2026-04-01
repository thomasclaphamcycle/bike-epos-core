import { Link } from "react-router-dom";
import { PublicSiteLayout } from "../components/PublicSiteLayout";
import {
  publicSitePaths,
  publicWorkshopJourney,
  publicWorkshopServiceTracks,
  secureCustomerTouchpoints,
} from "../features/publicSite/siteContent";

type CustomerSiteVariant = "home" | "services" | "workshop" | "contact";

type ContentCard = {
  title: string;
  detail: string;
};

type PageSection = {
  eyebrow: string;
  title: string;
  intro: string;
  cards: ContentCard[];
  testId?: string;
};

type PageContent = {
  eyebrow: string;
  title: string;
  intro: string;
  primaryCta: { label: string; to: string };
  secondaryCta: { label: string; to: string };
  heroCardTitle: string;
  heroCardItems: string[];
  heroHighlights: ContentCard[];
  primarySection: PageSection;
  secondarySection: PageSection;
  accentSection: PageSection;
  actionBand: {
    title: string;
    detail: string;
    primaryCta: { label: string; to: string };
    secondaryCta: { label: string; to: string };
  };
};

const workshopExpectationCards: ContentCard[] = [
  {
    title: "Requested dates stay realistic",
    detail:
      "Customers can suggest the day that suits them, but the workshop still confirms the final timing after reviewing bench load and bike details.",
  },
  {
    title: "Work changes are explained before approval",
    detail:
      "If the repair expands, the customer sees a secure estimate view that explains the proposal, the total, and whether approval is blocking progress.",
  },
  {
    title: "Collection should not feel vague",
    detail:
      "The online layer now leans into clear collection readiness and payment expectations instead of making customers guess whether the bike is really ready.",
  },
];

const contactCards: ContentCard[] = [
  {
    title: "Phone and email support",
    detail:
      "Call 01234 567890 or email hello@corepos-bikes.local if you need advice before booking or need help with a secure workshop link.",
  },
  {
    title: "Drop-off guidance",
    detail:
      "Workshop drop-off before 15:00 helps the team complete same-day triage where possible, especially for commuter faults and safety concerns.",
  },
  {
    title: "Collection timing",
    detail:
      "Collection still depends on approval, parts, and payment state. The secure repair update link is the clearest place to check the latest status.",
  },
];

const contentByVariant: Record<CustomerSiteVariant, PageContent> = {
  home: {
    eyebrow: "Workshop-first online booking",
    title: "Book repairs online with a clearer path from drop-off to collection.",
    intro:
      "CorePOS now has a real customer entry point: a workshop-first website that helps customers book work, understand what happens next, and follow secure updates without exposing the internal staff workflow.",
    primaryCta: { label: "Book workshop", to: publicSitePaths.bookWorkshop },
    secondaryCta: { label: "See repair journey", to: publicSitePaths.repairs },
    heroCardTitle: "What this online layer already covers",
    heroCardItems: [
      "Workshop booking requests with bike and issue context",
      "Secure estimate approval if work changes",
      "Customer-safe progress, collection, and payment visibility",
    ],
    heroHighlights: [
      {
        title: "Trust before the counter",
        detail:
          "Customers can understand the workshop process before they visit instead of discovering the journey one phone call at a time.",
      },
      {
        title: "Clear action-needed moments",
        detail:
          "Approval, waiting, in-progress, and ready-to-collect states are now easier to understand from the customer side.",
      },
      {
        title: "Built for future portal growth",
        detail:
          "The structure now points naturally toward future customer accounts, bike history, and broader online expansion.",
      },
    ],
    primarySection: {
      eyebrow: "Services",
      title: "Start with the workshop work customers ask about first",
      intro:
        "Phase 1 stays workshop-first, so the public site leads with the practical services that convert into real booking requests.",
      cards: publicWorkshopServiceTracks,
    },
    secondarySection: {
      eyebrow: "Journey",
      title: "Make the workshop process understandable before the bike is booked in",
      intro:
        "The site now explains the path from request to collection in plain customer language, using the same foundations already built in CorePOS.",
      cards: publicWorkshopJourney,
      testId: "public-site-journey",
    },
    accentSection: {
      eyebrow: "Secure follow-up",
      title: "Keep digital touchpoints connected instead of fragmented",
      intro:
        "Booking, approval, progress, and collection now feel like parts of one customer journey, even before full customer accounts exist.",
      cards: secureCustomerTouchpoints,
    },
    actionBand: {
      title: "Ready to tell the workshop about your bike?",
      detail:
        "Use the booking form to send the bike details, the issue, and the date that suits you best. The shop confirms the timing after review.",
      primaryCta: { label: "Start booking", to: publicSitePaths.bookWorkshop },
      secondaryCta: { label: "Contact the shop", to: publicSitePaths.contact },
    },
  },
  services: {
    eyebrow: "Workshop services",
    title: "Show practical repair and servicing options without sounding like an internal ops board.",
    intro:
      "The services layer now supports the booking flow instead of sitting beside it. Customers can see what the shop handles, what the workshop needs from them, and how follow-up works afterwards.",
    primaryCta: { label: "Book workshop", to: publicSitePaths.bookWorkshop },
    secondaryCta: { label: "Contact the shop", to: publicSitePaths.contact },
    heroCardTitle: "Popular reasons customers book",
    heroCardItems: [
      "Brake rub, gear slip, punctures, and safety checks",
      "Routine workshop servicing for road, commuter, and family bikes",
      "Accessory fitting, cable swaps, and tidy-up work before collection",
    ],
    heroHighlights: [
      {
        title: "Useful before the visit",
        detail:
          "The page is focused on helping customers recognise the closest service type, not on forcing them to understand the workshop internally.",
      },
      {
        title: "Context still matters",
        detail:
          "Customers can choose a service track, then describe the bike and issue in their own words so the workshop has real intake context.",
      },
      {
        title: "Booking is always close",
        detail:
          "The strongest next action stays visible so the customer can move into the booking journey without hunting for it.",
      },
    ],
    primarySection: {
      eyebrow: "Workshop categories",
      title: "Lead with workshop service types that turn into useful intake",
      intro:
        "These categories help frame the booking request while keeping room for the customer to explain the real issue in plain language.",
      cards: publicWorkshopServiceTracks,
    },
    secondarySection: {
      eyebrow: "Expectations",
      title: "Set expectations that protect both trust and workshop reality",
      intro:
        "The public layer should sound reassuring without promising unrealistic timing or bypassing the estimate approval controls already in place.",
      cards: workshopExpectationCards,
    },
    accentSection: {
      eyebrow: "Secure journey",
      title: "The service page should point clearly into the secure follow-up flow",
      intro:
        "Booking links, estimate approvals, and collection updates now sit behind one connected workshop-first story instead of isolated utility pages.",
      cards: secureCustomerTouchpoints,
    },
    actionBand: {
      title: "Choose the closest service track, then tell us what the bike needs.",
      detail:
        "The booking form is designed to capture enough detail for the workshop to respond sensibly without turning the customer experience into admin.",
      primaryCta: { label: "Book workshop", to: publicSitePaths.bookWorkshop },
      secondaryCta: { label: "See repair journey", to: publicSitePaths.repairs },
    },
  },
  workshop: {
    eyebrow: "Repair journey",
    title: "Explain the workshop journey before the customer needs to chase for updates.",
    intro:
      "This repair page now gives customers a clearer picture of what the workshop is doing, when approval matters, and how collection readiness becomes visible later in the job.",
    primaryCta: { label: "Book workshop", to: publicSitePaths.bookWorkshop },
    secondaryCta: { label: "Browse services", to: publicSitePaths.services },
    heroCardTitle: "What the customer should understand here",
    heroCardItems: [
      "Where the bike is in the repair process",
      "Whether the workshop is waiting on approval, parts, or bench work",
      "When the bike is ready and whether anything is still outstanding before collection",
    ],
    heroHighlights: [
      {
        title: "Approval is not hidden",
        detail:
          "If the workshop needs the customer to approve extra work, the online journey now treats that as the key trust moment it really is.",
      },
      {
        title: "Progress is simpler than the internal board",
        detail:
          "Customers see a plain-language summary of where the job stands instead of a direct copy of operational status terminology.",
      },
      {
        title: "Collection becomes explicit",
        detail:
          "Customers can see whether the bike is only nearly ready or actually ready to hand over, including payment expectations.",
      },
    ],
    primarySection: {
      eyebrow: "How it works",
      title: "Give customers a straight path through the workshop journey",
      intro:
        "The online layer should answer the next-step question at every stage, from sending the request through to collection.",
      cards: publicWorkshopJourney,
      testId: "public-site-journey",
    },
    secondarySection: {
      eyebrow: "Reassurance",
      title: "Explain the parts that often cause friction or uncertainty",
      intro:
        "These expectations help the site feel trustworthy instead of over-promising or leaving the customer to guess how the workshop will respond.",
      cards: workshopExpectationCards,
    },
    accentSection: {
      eyebrow: "Secure updates",
      title: "Each secure page now has a clearer role in the repair journey",
      intro:
        "The booking request, quote approval, and repair update pages are all still separate links, but they now read as one connected customer product.",
      cards: secureCustomerTouchpoints,
    },
    actionBand: {
      title: "Need to get the bike into the workshop?",
      detail:
        "Start with the booking request. If the repair later needs approval, the workshop will send the secure quote link when it matters.",
      primaryCta: { label: "Book workshop", to: publicSitePaths.bookWorkshop },
      secondaryCta: { label: "Contact the shop", to: publicSitePaths.contact },
    },
  },
  contact: {
    eyebrow: "Visit and contact",
    title: "Keep workshop contact details practical, visible, and connected to the online journey.",
    intro:
      "The contact layer should help customers decide whether to book online, ask a question first, or use the secure workshop links they already have.",
    primaryCta: { label: "Book workshop", to: publicSitePaths.bookWorkshop },
    secondaryCta: { label: "Browse services", to: publicSitePaths.services },
    heroCardTitle: "Use this page when you need",
    heroCardItems: [
      "Phone or email contact before booking",
      "Drop-off and collection guidance in one place",
      "A clear route back into the secure workshop flow afterwards",
    ],
    heroHighlights: [
      {
        title: "Contact still supports booking",
        detail:
          "The page helps the customer move forward instead of becoming a dead-end that strands them away from the workshop request flow.",
      },
      {
        title: "Store details are easy to trust",
        detail:
          "Opening hours, drop-off guidance, and collection expectations now sit in a clearer structure that feels like a real website page.",
      },
      {
        title: "Secure links stay first-class",
        detail:
          "If the customer already has a booking or quote link, the site makes it obvious that those secure pages remain the best place for the latest job status.",
      },
    ],
    primarySection: {
      eyebrow: "Practical contact",
      title: "Give customers the store information they actually need",
      intro:
        "This page stays useful by focusing on how to reach the shop, when to visit, and how the secure follow-up links fit into the journey.",
      cards: contactCards,
    },
    secondarySection: {
      eyebrow: "Repair journey",
      title: "The contact page should still explain what happens after the customer reaches out",
      intro:
        "Even when the customer calls or emails first, the workshop-first online layer should still guide them into a consistent booking and follow-up flow.",
      cards: publicWorkshopJourney,
      testId: "public-site-journey",
    },
    accentSection: {
      eyebrow: "Secure touchpoints",
      title: "Contact and secure updates should reinforce each other",
      intro:
        "Customers can contact the shop when they need help, but the booking, approval, and collection links remain the clearest source of truth for the live job.",
      cards: secureCustomerTouchpoints,
    },
    actionBand: {
      title: "Need help deciding the best next step?",
      detail:
        "If the bike needs workshop attention, booking online gives the shop the best starting context. If something is urgent or unclear, contact the team first.",
      primaryCta: { label: "Book workshop", to: publicSitePaths.bookWorkshop },
      secondaryCta: { label: "Contact the shop", to: publicSitePaths.contact },
    },
  },
};

const currentNavByVariant = {
  home: "home",
  services: "services",
  workshop: "repairs",
  contact: "contact",
} as const;

const renderSection = (section: PageSection) => (
  <section className="customer-site-section">
    <div className="customer-site-section-heading">
      <span className="customer-site-section-eyebrow">{section.eyebrow}</span>
      <h2>{section.title}</h2>
      <p>{section.intro}</p>
    </div>
    <div
      className="customer-site-card-grid"
      data-testid={section.testId}
    >
      {section.cards.map((card) => (
        <article key={card.title} className="customer-site-card">
          <h3>{card.title}</h3>
          <p>{card.detail}</p>
        </article>
      ))}
    </div>
  </section>
);

export const CustomerSitePage = ({ variant }: { variant: CustomerSiteVariant }) => {
  const content = contentByVariant[variant];

  return (
    <PublicSiteLayout currentNav={currentNavByVariant[variant]}>
      <div className="customer-site-shell" data-testid={`public-site-${variant}`}>
        <section className="customer-site-hero">
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
              <strong>{content.heroCardTitle}</strong>
              <ul className="customer-site-list">
                {content.heroCardItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </aside>
          </div>

          <div className="customer-site-dual-grid">
            {content.heroHighlights.map((card) => (
              <article key={card.title} className="customer-site-card customer-site-card--feature">
                <h2>{card.title}</h2>
                <p>{card.detail}</p>
              </article>
            ))}
          </div>
        </section>

        {renderSection(content.primarySection)}
        {renderSection(content.secondarySection)}

        <section className="customer-site-section customer-site-section-muted">
          <div className="customer-site-section-heading">
            <span className="customer-site-section-eyebrow">{content.accentSection.eyebrow}</span>
            <h2>{content.accentSection.title}</h2>
            <p>{content.accentSection.intro}</p>
          </div>
          <div className="customer-site-dual-grid">
            {content.accentSection.cards.map((card) => (
              <article key={card.title} className="customer-site-card customer-site-card--accent">
                <h3>{card.title}</h3>
                <p>{card.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="customer-site-section customer-site-section-last">
          <div className="customer-site-action-band">
            <div className="customer-site-action-copy">
              <span className="customer-site-section-eyebrow">Next step</span>
              <h2>{content.actionBand.title}</h2>
              <p>{content.actionBand.detail}</p>
            </div>
            <div className="actions-inline">
              <Link className="button-link" to={content.actionBand.primaryCta.to}>
                {content.actionBand.primaryCta.label}
              </Link>
              <Link className="button-link button-link-compact" to={content.actionBand.secondaryCta.to}>
                {content.actionBand.secondaryCta.label}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </PublicSiteLayout>
  );
};
