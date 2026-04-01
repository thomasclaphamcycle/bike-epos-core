export type PublicSiteNavKey = "home" | "services" | "repairs" | "contact";

export const publicSitePaths = {
  home: "/",
  homeAlias: "/site",
  services: "/services",
  servicesAlias: "/site/services",
  repairs: "/repairs",
  repairsAlias: "/site/workshop",
  contact: "/contact",
  contactAlias: "/site/contact",
  bookWorkshop: "/book-workshop",
  bookWorkshopAlias: "/site/book-workshop",
  bookingManage: (token: string) => `/bookings/${encodeURIComponent(token)}`,
  bookingManageAlias: (token: string) => `/site/bookings/${encodeURIComponent(token)}`,
  quote: (token: string) => `/quote/${encodeURIComponent(token)}`,
  quoteAlias: (token: string) => `/public/workshop/${encodeURIComponent(token)}`,
} as const;

export const publicSiteNavigation: Array<{
  key: PublicSiteNavKey;
  label: string;
  to: string;
}> = [
  { key: "home", label: "Overview", to: publicSitePaths.home },
  { key: "services", label: "Services", to: publicSitePaths.services },
  { key: "repairs", label: "Repairs", to: publicSitePaths.repairs },
  { key: "contact", label: "Contact", to: publicSitePaths.contact },
];

export const publicSiteTrustBadges = [
  "Workshop-first online booking",
  "Secure quote approval links",
  "Collection and payment status kept clear",
];

export const customerBookingSteps = [
  {
    title: "Send your request",
    detail: "Tell the shop what the bike needs and which date would suit you best.",
  },
  {
    title: "Workshop confirms timing",
    detail: "The team reviews the request and confirms the final drop-off plan with you.",
  },
  {
    title: "Approve extra work if needed",
    detail: "If the repair changes, you will get a secure quote link before the workshop continues.",
  },
  {
    title: "Collect when ready",
    detail: "You keep getting customer-safe updates until the bike is ready to collect.",
  },
];

export const publicWorkshopJourney = [
  {
    title: "Book the visit online",
    detail:
      "Share the bike details, the issue, and the preferred day before you arrive at the counter.",
  },
  {
    title: "Get realistic timing back",
    detail:
      "The workshop confirms the actual drop-off plan instead of promising a slot that is not bench-safe.",
  },
  {
    title: "Review quoted changes clearly",
    detail:
      "If the job changes, the customer gets a secure approval link that shows what changed and what happens next.",
  },
  {
    title: "Track progress to collection",
    detail:
      "Customers can see whether the workshop is waiting on approval, parts, work in progress, or collection.",
  },
];

export const publicWorkshopServiceTracks = [
  {
    title: "Safety checks and triage",
    detail:
      "Good for commuter issues, post-storage checks, noisy brakes, and quick fault finding before a bigger repair is agreed.",
  },
  {
    title: "Routine servicing",
    detail:
      "Ideal for tune-ups, seasonal servicing, drivetrain refreshes, and keeping regular riders reliable through the week.",
  },
  {
    title: "Repair and fitting work",
    detail:
      "Use this for brake work, punctures, cable swaps, accessory fitting, wheel issues, and individual workshop jobs.",
  },
  {
    title: "Collection-ready communication",
    detail:
      "The online layer is designed so customers understand when approval is blocking work and when collection is genuinely ready.",
  },
];

export const secureCustomerTouchpoints = [
  {
    title: "Booking request link",
    detail:
      "After submitting, the customer keeps a secure page for the request details, requested date, and workshop-safe updates.",
  },
  {
    title: "Estimate approval link",
    detail:
      "When work changes, approval happens through a separate secure quote page built to explain cost and next-step impact clearly.",
  },
  {
    title: "Progress and collection view",
    detail:
      "The repair update surface shows whether the shop is waiting on the customer, waiting on parts, or ready for collection.",
  },
];

export const publicSiteContactDetails = {
  businessName: "CorePOS Bikes",
  phone: "01234 567890",
  email: "hello@corepos-bikes.local",
  addressLines: ["Unit 4, Riverside Yard", "Openfield Road"],
  openingHours: ["Tue-Sat 9:00-17:30", "Workshop drop-off before 15:00 for same-day triage"],
};
