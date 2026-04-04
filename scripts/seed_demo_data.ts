import "dotenv/config";

import {
  Prisma,
  PrismaClient,
  PurchaseOrderStatus,
  WorkshopJobStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createThomasAdmin } from "./dev/create_thomas_admin";

const DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL or TEST_DATABASE_URL is required for demo seeding.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: DATABASE_URL,
  }),
});

const ensureMainLocation = async () =>
  prisma.location.upsert({
    where: { code: "MAIN" },
    update: {
      name: "Main",
      isActive: true,
    },
    create: {
      name: "Main",
      code: "MAIN",
      isActive: true,
    },
    select: { id: true },
  });

const ensureDemoStockLocation = async () =>
  prisma.stockLocation.upsert({
    where: { id: DEMO_STOCK_LOCATION.id },
    update: {
      name: DEMO_STOCK_LOCATION.name,
      isDefault: true,
    },
    create: {
      id: DEMO_STOCK_LOCATION.id,
      name: DEMO_STOCK_LOCATION.name,
      isDefault: true,
    },
    select: { id: true },
  });

type DemoProduct = {
  name: string;
  brand: string;
  description: string;
  sku: string;
  barcode: string;
  retailPricePence: number;
  costPricePence: number;
};

type DemoCustomer = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
};

type DemoWorkshopJob = {
  id: string;
  customerId: string;
  customerName: string;
  bikeDescription: string;
  status: WorkshopJobStatus;
  scheduledDate?: string;
  notes: string;
  line: {
    id: string;
    type: "LABOUR" | "PART";
    description: string;
    qty: number;
    unitPricePence: number;
    sku?: string;
  };
};

type DemoWorkshopServiceTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  sortOrder: number;
  defaultDurationMinutes: number;
  lines: Array<{
    id: string;
    type: "LABOUR" | "PART";
    description: string;
    qty: number;
    unitPricePence: number;
    isOptional?: boolean;
  }>;
};

type DemoSale = {
  id: string;
  basketId: string;
  customerId: string | null;
  createdByUsername: "admin" | "manager" | "staff";
  completed: boolean;
  completedAt?: string;
  receiptNumber?: string;
  tenders?: Array<{
    id: string;
    method: "CASH" | "CARD" | "BANK_TRANSFER" | "VOUCHER";
    amountPence: number;
  }>;
  payments?: Array<{
    id: string;
    method: "CASH" | "CARD" | "OTHER";
    amountPence: number;
    providerRef?: string;
  }>;
  items: Array<{
    id: string;
    sku: string;
    quantity: number;
  }>;
};

type DemoOpeningStock = {
  inventoryMovementId: string;
  stockLedgerEntryId: string;
  sku: string;
  quantity: number;
  unitCostPence: number;
  note: string;
};

type DemoSupplier = {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
};

type DemoPurchaseOrder = {
  id: string;
  poNumber: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  orderedAt: string;
  expectedAt: string;
  notes: string;
  items: Array<{
    id: string;
    sku: string;
    quantityOrdered: number;
    quantityReceived: number;
    unitCostPence: number;
  }>;
};

type DemoWebOrder = {
  id: string;
  orderNumber: string;
  customerId: string | null;
  status: "READY_FOR_DISPATCH" | "DISPATCHED" | "CANCELLED";
  fulfillmentMethod: "SHIPPING" | "CLICK_AND_COLLECT";
  sourceChannel: string;
  externalOrderRef: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  deliveryInstructions: string | null;
  shippingRecipientName: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string | null;
  shippingCity: string;
  shippingRegion: string | null;
  shippingPostcode: string;
  shippingCountry: string;
  shippingPricePence: number;
  placedAt: string;
  packedAt?: string | null;
  items: Array<{
    id: string;
    sku: string;
    quantity: number;
  }>;
};

type DemoPrinter = {
  id: string;
  name: string;
  key: string;
  printerFamily: "ZEBRA_LABEL";
  printerModelHint: "GK420D_OR_COMPATIBLE";
  supportsShippingLabels: boolean;
  isActive: boolean;
  transportMode: "DRY_RUN" | "RAW_TCP";
  rawTcpHost: string | null;
  rawTcpPort: number | null;
  location: string | null;
  notes: string | null;
};

const toRelativeIso = (dayOffset: number, hour = 10, minute = 0) => {
  const date = new Date();
  date.setUTCHours(hour, minute, 0, 0);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString();
};

const startOfUtcDay = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const DEMO_STOCK_LOCATION = {
  id: "40000000-0000-4000-8000-000000000001",
  name: "Main Stock",
};

const DEMO_STORE_OPENING_HOURS = {
  MONDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  TUESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  WEDNESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  THURSDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  FRIDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  SATURDAY: { isClosed: false, opensAt: "09:00", closesAt: "16:30" },
  SUNDAY: { isClosed: true, opensAt: "", closesAt: "" },
} satisfies Prisma.InputJsonValue;

const DEMO_STORE_PROFILE = {
  name: "CorePOS Demo Store",
  businessName: "CorePOS Demo Store Ltd",
  email: "hello@corepos.demo",
  phone: "01234 567890",
  website: "https://demo.corepos.local",
  addressLine1: "1 Demo High Street",
  addressLine2: "",
  city: "Clapham",
  region: "Greater London",
  postcode: "SW4 0HY",
  country: "United Kingdom",
  vatNumber: "GB123456789",
  companyNumber: "01234567",
  defaultCurrency: "GBP",
  timeZone: "Europe/London",
  logoUrl: "",
  footerText: "Thanks for riding with CorePOS.",
} as const;

const DEMO_BOOKING_DEFAULTS = {
  maxBookingsPerDay: 8,
  defaultDepositPence: 1000,
  defaultJobDurationMinutes: 60,
  manageTokenTtlDays: 30,
  requestTimingMessage:
    "Choose a preferred workshop date and drop-off preference. The shop will confirm the final timing if a precise slot is needed.",
} as const;

const DEMO_NOTIFICATION_DEFAULTS = {
  workshopAutoSendEnabled: true,
  workshopEmailEnabled: true,
  workshopSmsEnabled: true,
  workshopWhatsappEnabled: true,
} as const;

const DEMO_OPERATIONS_DEFAULTS = {
  lowStockThreshold: 3,
  dashboardWeatherEnabled: true,
} as const;

const DEMO_RECEIPT_ADDRESS = [
  DEMO_STORE_PROFILE.addressLine1,
  DEMO_STORE_PROFILE.addressLine2,
  [DEMO_STORE_PROFILE.city, DEMO_STORE_PROFILE.region].filter(Boolean).join(", "),
  [DEMO_STORE_PROFILE.postcode, DEMO_STORE_PROFILE.country].filter(Boolean).join(" "),
]
  .filter(Boolean)
  .join(", ");

const DEMO_APP_CONFIG_ROWS: Array<{ key: string; value: Prisma.InputJsonValue }> = [
  { key: "store.name", value: DEMO_STORE_PROFILE.name },
  { key: "store.businessName", value: DEMO_STORE_PROFILE.businessName },
  { key: "store.email", value: DEMO_STORE_PROFILE.email },
  { key: "store.phone", value: DEMO_STORE_PROFILE.phone },
  { key: "store.website", value: DEMO_STORE_PROFILE.website },
  { key: "store.addressLine1", value: DEMO_STORE_PROFILE.addressLine1 },
  { key: "store.addressLine2", value: DEMO_STORE_PROFILE.addressLine2 },
  { key: "store.city", value: DEMO_STORE_PROFILE.city },
  { key: "store.region", value: DEMO_STORE_PROFILE.region },
  { key: "store.postcode", value: DEMO_STORE_PROFILE.postcode },
  { key: "store.country", value: DEMO_STORE_PROFILE.country },
  { key: "store.openingHours", value: DEMO_STORE_OPENING_HOURS },
  { key: "store.vatNumber", value: DEMO_STORE_PROFILE.vatNumber },
  { key: "store.companyNumber", value: DEMO_STORE_PROFILE.companyNumber },
  { key: "store.defaultCurrency", value: DEMO_STORE_PROFILE.defaultCurrency },
  { key: "store.timeZone", value: DEMO_STORE_PROFILE.timeZone },
  { key: "store.logoUrl", value: DEMO_STORE_PROFILE.logoUrl },
  { key: "store.footerText", value: DEMO_STORE_PROFILE.footerText },
  { key: "workshop.defaultJobDurationMinutes", value: DEMO_BOOKING_DEFAULTS.defaultJobDurationMinutes },
  { key: "workshop.defaultDepositPence", value: DEMO_BOOKING_DEFAULTS.defaultDepositPence },
  { key: "workshop.maxBookingsPerDay", value: DEMO_BOOKING_DEFAULTS.maxBookingsPerDay },
  { key: "workshop.manageTokenTtlDays", value: DEMO_BOOKING_DEFAULTS.manageTokenTtlDays },
  { key: "workshop.requestTimingMessage", value: DEMO_BOOKING_DEFAULTS.requestTimingMessage },
  { key: "notifications.workshopAutoSendEnabled", value: DEMO_NOTIFICATION_DEFAULTS.workshopAutoSendEnabled },
  { key: "notifications.workshopEmailEnabled", value: DEMO_NOTIFICATION_DEFAULTS.workshopEmailEnabled },
  { key: "notifications.workshopSmsEnabled", value: DEMO_NOTIFICATION_DEFAULTS.workshopSmsEnabled },
  { key: "notifications.workshopWhatsappEnabled", value: DEMO_NOTIFICATION_DEFAULTS.workshopWhatsappEnabled },
  { key: "operations.lowStockThreshold", value: DEMO_OPERATIONS_DEFAULTS.lowStockThreshold },
  { key: "operations.dashboardWeatherEnabled", value: DEMO_OPERATIONS_DEFAULTS.dashboardWeatherEnabled },
];

const LEGACY_REMOVED_USERS = [
  {
    id: "compat-check",
    username: "header_636f6d7061742d636865636b",
    email: null,
  },
  {
    id: null,
    username: "admin",
    email: "admin@local",
  },
  {
    id: null,
    username: "manager",
    email: "manager@local",
  },
  {
    id: null,
    username: "staff",
    email: "staff@local",
  },
];

const DEMO_PRODUCTS: DemoProduct[] = [
  {
    name: "Demo City Bike 52cm",
    brand: "MetroRide",
    description: "Step-through city bike for an easy complete-bike sale walkthrough.",
    sku: "DEMO-BIKE-C52",
    barcode: "DEMO-BC-C52",
    retailPricePence: 74999,
    costPricePence: 51000,
  },
  {
    name: "Demo Helmet Road",
    brand: "SafeLine",
    description: "Lightweight road helmet for a simple accessory sale.",
    sku: "DEMO-ACC-HELMET",
    barcode: "DEMO-BC-HELMET",
    retailPricePence: 5999,
    costPricePence: 3100,
  },
  {
    name: "Demo Floor Pump",
    brand: "AirFlow",
    description: "Workshop floor pump with pressure gauge.",
    sku: "DEMO-ACC-PUMP",
    barcode: "DEMO-BC-PUMP",
    retailPricePence: 3499,
    costPricePence: 1800,
  },
  {
    name: "Demo Chain Lube 120ml",
    brand: "SmoothRide",
    description: "All-weather chain lubricant for a quick basket add-on.",
    sku: "DEMO-ACC-LUBE",
    barcode: "DEMO-BC-LUBE",
    retailPricePence: 899,
    costPricePence: 400,
  },
  {
    name: "Demo Inner Tube 700x25-32",
    brand: "AirFlow",
    description: "Road inner tube used by the workshop demo jobs.",
    sku: "DEMO-PART-TUBE700",
    barcode: "DEMO-BC-TUBE700",
    retailPricePence: 699,
    costPricePence: 300,
  },
  {
    name: "Demo Brake Pads Resin",
    brand: "StopFast",
    description: "Resin hydraulic disc brake pads for workshop and PO flows.",
    sku: "DEMO-PART-PADS-R",
    barcode: "DEMO-BC-PADS",
    retailPricePence: 1499,
    costPricePence: 700,
  },
  {
    name: "Demo Cassette 11-30",
    brand: "DriveTech",
    description: "11-speed cassette used by the waiting-for-parts workshop demo.",
    sku: "DEMO-PART-CASS1130",
    barcode: "DEMO-BC-CASS1130",
    retailPricePence: 4599,
    costPricePence: 2900,
  },
];

const DEMO_OPENING_STOCK: DemoOpeningStock[] = [
  {
    inventoryMovementId: "demo-opening-stock-001",
    stockLedgerEntryId: "60000000-0000-4000-8000-000000000001",
    sku: "DEMO-BIKE-C52",
    quantity: 2,
    unitCostPence: 51000,
    note: "Demo opening stock for complete-bike POS walkthroughs.",
  },
  {
    inventoryMovementId: "demo-opening-stock-002",
    stockLedgerEntryId: "60000000-0000-4000-8000-000000000002",
    sku: "DEMO-ACC-HELMET",
    quantity: 6,
    unitCostPence: 3100,
    note: "Demo opening stock for accessory sales.",
  },
  {
    inventoryMovementId: "demo-opening-stock-003",
    stockLedgerEntryId: "60000000-0000-4000-8000-000000000003",
    sku: "DEMO-ACC-PUMP",
    quantity: 4,
    unitCostPence: 1800,
    note: "Demo opening stock for accessory sales.",
  },
  {
    inventoryMovementId: "demo-opening-stock-004",
    stockLedgerEntryId: "60000000-0000-4000-8000-000000000004",
    sku: "DEMO-ACC-LUBE",
    quantity: 8,
    unitCostPence: 400,
    note: "Demo opening stock for low-value add-on sales.",
  },
  {
    inventoryMovementId: "demo-opening-stock-005",
    stockLedgerEntryId: "60000000-0000-4000-8000-000000000005",
    sku: "DEMO-PART-TUBE700",
    quantity: 12,
    unitCostPence: 300,
    note: "Demo opening stock for workshop puncture repairs.",
  },
  {
    inventoryMovementId: "demo-opening-stock-006",
    stockLedgerEntryId: "60000000-0000-4000-8000-000000000006",
    sku: "DEMO-PART-PADS-R",
    quantity: 8,
    unitCostPence: 700,
    note: "Demo opening stock for workshop brake jobs.",
  },
  {
    inventoryMovementId: "demo-opening-stock-007",
    stockLedgerEntryId: "60000000-0000-4000-8000-000000000007",
    sku: "DEMO-PART-CASS1130",
    quantity: 3,
    unitCostPence: 2900,
    note: "Demo opening stock for drivetrain workshop jobs.",
  },
];

const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Alex Turner",
    firstName: "Alex",
    lastName: "Turner",
    email: "alex.turner+corepos-demo@demo.local",
    phone: "07700000001",
    notes: "Use for a simple POS sale or customer attachment walkthrough.",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Jordan Patel",
    firstName: "Jordan",
    lastName: "Patel",
    email: "jordan.patel+corepos-demo@demo.local",
    phone: "07700000002",
    notes: "Use for workshop intake and status updates.",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Riley Evans",
    firstName: "Riley",
    lastName: "Evans",
    email: "riley.evans+corepos-demo@demo.local",
    phone: "07700000003",
    notes: "Waiting-for-parts workshop customer.",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Jamie Green",
    firstName: "Jamie",
    lastName: "Green",
    email: "jamie.green+corepos-demo@demo.local",
    phone: "07700000004",
    notes: "Ready-for-collection workshop customer.",
  },
];

const DEMO_WORKSHOP_JOBS: DemoWorkshopJob[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    customerId: DEMO_CUSTOMERS[1].id,
    customerName: DEMO_CUSTOMERS[1].name,
    bikeDescription: "MetroRide commuter bike - booked for safety check",
    status: "BOOKED",
    scheduledDate: toRelativeIso(1, 9, 30),
    notes: "Minimal demo booking ready for intake and approval flow.",
    line: {
      id: "21000000-0000-4000-8000-000000000001",
      type: "LABOUR",
      description: "Initial safety inspection",
      qty: 1,
      unitPricePence: 2500,
    },
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    customerId: DEMO_CUSTOMERS[2].id,
    customerName: DEMO_CUSTOMERS[2].name,
    bikeDescription: "Road bike - waiting on cassette replacement",
    status: "WAITING_FOR_PARTS",
    scheduledDate: toRelativeIso(0, 11, 0),
    notes: "Clear parts-blocked demo job linked to the demo purchase order.",
    line: {
      id: "21000000-0000-4000-8000-000000000002",
      type: "PART",
      description: "Install cassette 11-30",
      qty: 1,
      unitPricePence: 4599,
      sku: "DEMO-PART-CASS1130",
    },
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    customerId: DEMO_CUSTOMERS[3].id,
    customerName: DEMO_CUSTOMERS[3].name,
    bikeDescription: "Hybrid bike - ready for collection",
    status: "READY_FOR_COLLECTION",
    scheduledDate: toRelativeIso(-1, 15, 0),
    notes: "Use this for collection, finalize-to-basket, and workshop checkout walkthroughs.",
    line: {
      id: "21000000-0000-4000-8000-000000000003",
      type: "PART",
      description: "Replace brake pads",
      qty: 1,
      unitPricePence: 1499,
      sku: "DEMO-PART-PADS-R",
    },
  },
];

const DEMO_WORKSHOP_SERVICE_TEMPLATES: DemoWorkshopServiceTemplate[] = [
  {
    id: "90000000-0000-4000-8000-000000000001",
    name: "Inspection & Safety Check",
    description: "Fast intake check for safety, wear, and next-step advice.",
    category: "Inspection",
    sortOrder: 0,
    defaultDurationMinutes: 30,
    lines: [
      {
        id: "90000000-0000-4000-8000-100000000001",
        type: "LABOUR",
        description: "Workshop inspection and safety assessment",
        qty: 1,
        unitPricePence: 2500,
      },
    ],
  },
  {
    id: "90000000-0000-4000-8000-000000000002",
    name: "Basic Service",
    description: "Core tune-up for bikes that need a straightforward refresh.",
    category: "Service",
    sortOrder: 1,
    defaultDurationMinutes: 60,
    lines: [
      {
        id: "90000000-0000-4000-8000-100000000002",
        type: "LABOUR",
        description: "Basic service labour",
        qty: 1,
        unitPricePence: 6500,
      },
    ],
  },
  {
    id: "90000000-0000-4000-8000-000000000003",
    name: "Pro Service",
    description: "Deeper workshop service for heavier use or repeat riders.",
    category: "Service",
    sortOrder: 2,
    defaultDurationMinutes: 90,
    lines: [
      {
        id: "90000000-0000-4000-8000-100000000003",
        type: "LABOUR",
        description: "Pro service labour",
        qty: 1,
        unitPricePence: 9500,
      },
    ],
  },
  {
    id: "90000000-0000-4000-8000-000000000004",
    name: "Elite Service",
    description: "Full workshop strip, rebuild, and performance setup.",
    category: "Service",
    sortOrder: 3,
    defaultDurationMinutes: 120,
    lines: [
      {
        id: "90000000-0000-4000-8000-100000000004",
        type: "LABOUR",
        description: "Elite service labour",
        qty: 1,
        unitPricePence: 13500,
      },
    ],
  },
];

const DEMO_SUPPLIERS: DemoSupplier[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    name: "Demo Parts Supply",
    contactName: "Mia Jones",
    email: "buying+corepos-demo@demo-supplier.local",
    phone: "02070000001",
    notes: "Minimal seeded supplier for purchasing and receiving evaluation.",
  },
];

const DEMO_PURCHASE_ORDERS: DemoPurchaseOrder[] = [
  {
    id: "51000000-0000-4000-8000-000000000001",
    poNumber: "COREPOS-DEMO-PO-0001",
    supplierId: DEMO_SUPPLIERS[0].id,
    status: "SENT",
    orderedAt: toRelativeIso(-1, 9, 0),
    expectedAt: toRelativeIso(2, 14, 0),
    notes: "Demo purchase order left open so receiving can be tested immediately.",
    items: [
      {
        id: "51100000-0000-4000-8000-000000000001",
        sku: "DEMO-PART-CASS1130",
        quantityOrdered: 2,
        quantityReceived: 0,
        unitCostPence: 2800,
      },
      {
        id: "51100000-0000-4000-8000-000000000002",
        sku: "DEMO-PART-PADS-R",
        quantityOrdered: 6,
        quantityReceived: 0,
        unitCostPence: 650,
      },
    ],
  },
];

const DEMO_SALES: DemoSale[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    basketId: "31000000-0000-4000-8000-000000000001",
    customerId: DEMO_CUSTOMERS[0].id,
    createdByUsername: "staff",
    completed: true,
    completedAt: toRelativeIso(-1, 11, 15),
    receiptNumber: "COREPOS-DEMO-REC-0001",
    tenders: [{ id: "33000000-0000-4000-8000-000000000001", method: "CARD", amountPence: 6898 }],
    payments: [
      {
        id: "34000000-0000-4000-8000-000000000001",
        method: "CARD",
        amountPence: 6898,
        providerRef: "DEMO-CARD-0001",
      },
    ],
    items: [
      { id: "32000000-0000-4000-8000-000000000001", sku: "DEMO-ACC-HELMET", quantity: 1 },
      { id: "32000000-0000-4000-8000-000000000002", sku: "DEMO-ACC-LUBE", quantity: 1 },
    ],
  },
];

const DEMO_WEB_ORDERS: DemoWebOrder[] = [
  {
    id: "36000000-0000-4000-8000-000000000001",
    orderNumber: "WEB-DEMO-1001",
    customerId: DEMO_CUSTOMERS[0].id,
    status: "READY_FOR_DISPATCH",
    fulfillmentMethod: "SHIPPING",
    sourceChannel: "INTERNAL_MOCK_WEB_STORE",
    externalOrderRef: "checkout-session-demo-1001",
    customerName: DEMO_CUSTOMERS[0].name,
    customerEmail: DEMO_CUSTOMERS[0].email,
    customerPhone: DEMO_CUSTOMERS[0].phone,
    deliveryInstructions: "Leave in the signed-for parcel cage if dispatch is after collection.",
    shippingRecipientName: DEMO_CUSTOMERS[0].name,
    shippingAddressLine1: "7 Courier Yard",
    shippingAddressLine2: "Unit B",
    shippingCity: "Clapham",
    shippingRegion: "London",
    shippingPostcode: "SW4 0HY",
    shippingCountry: "United Kingdom",
    shippingPricePence: 495,
    placedAt: toRelativeIso(-1, 13, 15),
    packedAt: toRelativeIso(0, 8, 30),
    items: [
      {
        id: "36100000-0000-4000-8000-000000000001",
        sku: "DEMO-ACC-PUMP",
        quantity: 1,
      },
      {
        id: "36100000-0000-4000-8000-000000000002",
        sku: "DEMO-PART-TUBE700",
        quantity: 2,
      },
    ],
  },
  {
    id: "36000000-0000-4000-8000-000000000002",
    orderNumber: "WEB-DEMO-1002",
    customerId: DEMO_CUSTOMERS[1].id,
    status: "READY_FOR_DISPATCH",
    fulfillmentMethod: "CLICK_AND_COLLECT",
    sourceChannel: "INTERNAL_MOCK_WEB_STORE",
    externalOrderRef: "checkout-session-demo-1002",
    customerName: DEMO_CUSTOMERS[1].name,
    customerEmail: DEMO_CUSTOMERS[1].email,
    customerPhone: DEMO_CUSTOMERS[1].phone,
    deliveryInstructions: "Customer will collect after workshop appointment.",
    shippingRecipientName: DEMO_CUSTOMERS[1].name,
    shippingAddressLine1: "1 Demo High Street",
    shippingAddressLine2: "",
    shippingCity: "Clapham",
    shippingRegion: "London",
    shippingPostcode: "SW4 0HY",
    shippingCountry: "United Kingdom",
    shippingPricePence: 0,
    placedAt: toRelativeIso(0, 9, 45),
    packedAt: null,
    items: [
      {
        id: "36100000-0000-4000-8000-000000000003",
        sku: "DEMO-ACC-HELMET",
        quantity: 1,
      },
    ],
  },
];

const DEMO_DISPATCH_PRINTERS: DemoPrinter[] = [
  {
    id: "37000000-0000-4000-8000-000000000001",
    name: "Dispatch Zebra GK420d",
    key: "DISPATCH_ZEBRA_GK420D",
    printerFamily: "ZEBRA_LABEL",
    printerModelHint: "GK420D_OR_COMPATIBLE",
    supportsShippingLabels: true,
    isActive: true,
    transportMode: "DRY_RUN",
    rawTcpHost: null,
    rawTcpPort: null,
    location: "Dispatch bench",
    notes: "Demo default shipping-label printer for local and dry-run dispatch flows.",
  },
];

const toReceiptSettings = async () => {
  for (const row of DEMO_APP_CONFIG_ROWS) {
    await prisma.appConfig.upsert({
      where: { key: row.key },
      update: { value: row.value },
      create: row,
    });
  }

  await prisma.receiptSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      shopName: DEMO_STORE_PROFILE.name,
      shopAddress: DEMO_RECEIPT_ADDRESS,
      vatNumber: DEMO_STORE_PROFILE.vatNumber,
      footerText: DEMO_STORE_PROFILE.footerText,
    },
    update: {
      shopName: DEMO_STORE_PROFILE.name,
      shopAddress: DEMO_RECEIPT_ADDRESS,
      vatNumber: DEMO_STORE_PROFILE.vatNumber,
      footerText: DEMO_STORE_PROFILE.footerText,
    },
  });

  await prisma.bookingSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      minBookableDate: startOfUtcDay(new Date()),
      maxBookingsPerDay: DEMO_BOOKING_DEFAULTS.maxBookingsPerDay,
      defaultDepositPence: DEMO_BOOKING_DEFAULTS.defaultDepositPence,
    },
    update: {
      maxBookingsPerDay: DEMO_BOOKING_DEFAULTS.maxBookingsPerDay,
      defaultDepositPence: DEMO_BOOKING_DEFAULTS.defaultDepositPence,
    },
  });
};

const seedDemoDispatchPrinters = async () => {
  for (const printer of DEMO_DISPATCH_PRINTERS) {
    await prisma.printer.upsert({
      where: { id: printer.id },
      update: {
        name: printer.name,
        key: printer.key,
        printerFamily: printer.printerFamily,
        printerModelHint: printer.printerModelHint,
        supportsShippingLabels: printer.supportsShippingLabels,
        isActive: printer.isActive,
        transportMode: printer.transportMode,
        rawTcpHost: printer.rawTcpHost,
        rawTcpPort: printer.rawTcpPort,
        location: printer.location,
        notes: printer.notes,
      },
      create: printer,
    });
  }

  await prisma.appConfig.upsert({
    where: { key: "dispatch.defaultShippingLabelPrinterId" },
    update: { value: DEMO_DISPATCH_PRINTERS[0].id },
    create: {
      key: "dispatch.defaultShippingLabelPrinterId",
      value: DEMO_DISPATCH_PRINTERS[0].id,
    },
  });
};

const removeLegacyDemoUsers = async () => {
  const emails = LEGACY_REMOVED_USERS.map((user) => user.email).filter(
    (email): email is string => Boolean(email),
  );
  const usernames = LEGACY_REMOVED_USERS.map((user) => user.username);
  const ids = LEGACY_REMOVED_USERS.map((user) => user.id).filter(
    (id): id is string => Boolean(id),
  );

  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { in: emails } },
        { username: { in: usernames } },
        { id: { in: ids } },
      ],
    },
  });
};

const seedDemoProducts = async () => {
  const variantBySku = new Map<string, { id: string; productId: string; retailPricePence: number }>();

  for (const product of DEMO_PRODUCTS) {
    let dbProduct = await prisma.product.findFirst({
      where: {
        name: product.name,
        brand: product.brand,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!dbProduct) {
      dbProduct = await prisma.product.create({
        data: {
          name: product.name,
          brand: product.brand,
          description: product.description,
          isActive: true,
        },
        select: { id: true },
      });
    } else {
      await prisma.product.update({
        where: { id: dbProduct.id },
        data: {
          description: product.description,
          isActive: true,
        },
      });
    }

    const retailPrice = new Prisma.Decimal(product.retailPricePence / 100).toDecimalPlaces(2);

    const variant = await prisma.variant.upsert({
      where: { sku: product.sku },
      update: {
        productId: dbProduct.id,
        name: product.name,
        option: "Default",
        barcode: product.barcode,
        manufacturerBarcode: product.barcode,
        internalBarcode: null,
        retailPrice,
        retailPricePence: product.retailPricePence,
        costPricePence: product.costPricePence,
        isActive: true,
      },
      create: {
        productId: dbProduct.id,
        sku: product.sku,
        name: product.name,
        option: "Default",
        barcode: product.barcode,
        manufacturerBarcode: product.barcode,
        internalBarcode: null,
        retailPrice,
        retailPricePence: product.retailPricePence,
        costPricePence: product.costPricePence,
        isActive: true,
      },
      select: {
        id: true,
        productId: true,
        retailPricePence: true,
      },
    });

    await prisma.barcode.upsert({
      where: { code: product.barcode },
      update: {
        variantId: variant.id,
        isPrimary: true,
      },
      create: {
        variantId: variant.id,
        code: product.barcode,
        type: "EAN",
        isPrimary: true,
      },
    });

    variantBySku.set(product.sku, variant);
  }

  return variantBySku;
};

const seedDemoCustomers = async () => {
  for (const customer of DEMO_CUSTOMERS) {
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        OR: [{ id: customer.id }, { email: customer.email }],
      },
      select: { id: true },
    });

    const customerData = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      notes: customer.notes,
    };

    if (existingCustomer) {
      await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: customerData,
      });
      continue;
    }

    await prisma.customer.create({
      data: {
        id: customer.id,
        ...customerData,
      },
    });
  }
};

const seedDemoOpeningStock = async (
  variantBySku: Map<string, { id: string; productId: string; retailPricePence: number }>,
) => {
  const stockLocation = await ensureDemoStockLocation();

  for (const item of DEMO_OPENING_STOCK) {
    const variant = variantBySku.get(item.sku);
    if (!variant) {
      throw new Error(`Missing seeded variant for sku ${item.sku}`);
    }

    await prisma.inventoryMovement.upsert({
      where: { id: item.inventoryMovementId },
      update: {
        variantId: variant.id,
        type: "ADJUSTMENT",
        quantity: item.quantity,
        unitCost: new Prisma.Decimal(item.unitCostPence),
        referenceType: "DEMO_OPENING_STOCK",
        referenceId: item.inventoryMovementId,
        note: item.note,
      },
      create: {
        id: item.inventoryMovementId,
        variantId: variant.id,
        type: "ADJUSTMENT",
        quantity: item.quantity,
        unitCost: new Prisma.Decimal(item.unitCostPence),
        referenceType: "DEMO_OPENING_STOCK",
        referenceId: item.inventoryMovementId,
        note: item.note,
      },
    });

    await prisma.stockLedgerEntry.upsert({
      where: { id: item.stockLedgerEntryId },
      update: {
        variantId: variant.id,
        locationId: stockLocation.id,
        type: "ADJUSTMENT",
        quantityDelta: item.quantity,
        unitCostPence: item.unitCostPence,
        referenceType: "DEMO_OPENING_STOCK",
        referenceId: item.inventoryMovementId,
        note: item.note,
      },
      create: {
        id: item.stockLedgerEntryId,
        variantId: variant.id,
        locationId: stockLocation.id,
        type: "ADJUSTMENT",
        quantityDelta: item.quantity,
        unitCostPence: item.unitCostPence,
        referenceType: "DEMO_OPENING_STOCK",
        referenceId: item.inventoryMovementId,
        note: item.note,
      },
    });
  }
};

const seedDemoWorkshopJobs = async (
  variantBySku: Map<string, { id: string; productId: string; retailPricePence: number }>,
) => {
  const location = await ensureMainLocation();

  for (const job of DEMO_WORKSHOP_JOBS) {
    await prisma.workshopJob.upsert({
      where: { id: job.id },
      update: {
        customerId: job.customerId,
        locationId: location.id,
        customerName: job.customerName,
        bikeDescription: job.bikeDescription,
        status: job.status,
        scheduledDate: job.scheduledDate ? new Date(job.scheduledDate) : null,
        notes: job.notes,
        source: "IN_STORE",
      },
      create: {
        id: job.id,
        customerId: job.customerId,
        locationId: location.id,
        customerName: job.customerName,
        bikeDescription: job.bikeDescription,
        status: job.status,
        scheduledDate: job.scheduledDate ? new Date(job.scheduledDate) : null,
        notes: job.notes,
        source: "IN_STORE",
      },
    });

    const lineVariant =
      job.line.type === "PART" && job.line.sku ? variantBySku.get(job.line.sku) : undefined;

    await prisma.workshopJobLine.upsert({
      where: { id: job.line.id },
      update: {
        jobId: job.id,
        type: job.line.type,
        description: job.line.description,
        qty: job.line.qty,
        unitPricePence: job.line.unitPricePence,
        productId: lineVariant?.productId ?? null,
        variantId: lineVariant?.id ?? null,
      },
      create: {
        id: job.line.id,
        jobId: job.id,
        type: job.line.type,
        description: job.line.description,
        qty: job.line.qty,
        unitPricePence: job.line.unitPricePence,
        productId: lineVariant?.productId ?? null,
        variantId: lineVariant?.id ?? null,
      },
    });
  }
};

const seedDemoWorkshopServiceTemplates = async () => {
  for (const template of DEMO_WORKSHOP_SERVICE_TEMPLATES) {
    await prisma.workshopServiceTemplate.upsert({
      where: { id: template.id },
      update: {
        name: template.name,
        description: template.description,
        category: template.category,
        sortOrder: template.sortOrder,
        defaultDurationMinutes: template.defaultDurationMinutes,
        pricingMode: "STANDARD_SERVICE",
        targetTotalPricePence: null,
        isActive: true,
      },
      create: {
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        sortOrder: template.sortOrder,
        defaultDurationMinutes: template.defaultDurationMinutes,
        pricingMode: "STANDARD_SERVICE",
        targetTotalPricePence: null,
        isActive: true,
      },
    });

    await prisma.workshopServiceTemplateLine.deleteMany({
      where: { templateId: template.id },
    });

    await prisma.workshopServiceTemplateLine.createMany({
      data: template.lines.map((line, index) => ({
        id: line.id,
        templateId: template.id,
        type: line.type,
        productId: null,
        variantId: null,
        description: line.description,
        qty: line.qty,
        unitPricePence: line.unitPricePence,
        isOptional: line.isOptional ?? false,
        sortOrder: index,
      })),
    });
  }
};

const seedDemoSuppliers = async () => {
  for (const supplier of DEMO_SUPPLIERS) {
    await prisma.supplier.upsert({
      where: { id: supplier.id },
      update: {
        name: supplier.name,
        contactName: supplier.contactName,
        email: supplier.email,
        phone: supplier.phone,
        notes: supplier.notes,
      },
      create: {
        id: supplier.id,
        name: supplier.name,
        contactName: supplier.contactName,
        email: supplier.email,
        phone: supplier.phone,
        notes: supplier.notes,
      },
    });
  }
};

const seedDemoPurchaseOrders = async (
  variantBySku: Map<string, { id: string; productId: string; retailPricePence: number }>,
) => {
  for (const purchaseOrder of DEMO_PURCHASE_ORDERS) {
    await prisma.purchaseOrder.upsert({
      where: { id: purchaseOrder.id },
      update: {
        poNumber: purchaseOrder.poNumber,
        supplierId: purchaseOrder.supplierId,
        status: purchaseOrder.status,
        orderedAt: new Date(purchaseOrder.orderedAt),
        expectedAt: new Date(purchaseOrder.expectedAt),
        notes: purchaseOrder.notes,
      },
      create: {
        id: purchaseOrder.id,
        poNumber: purchaseOrder.poNumber,
        supplierId: purchaseOrder.supplierId,
        status: purchaseOrder.status,
        orderedAt: new Date(purchaseOrder.orderedAt),
        expectedAt: new Date(purchaseOrder.expectedAt),
        notes: purchaseOrder.notes,
      },
    });

    for (const item of purchaseOrder.items) {
      const variant = variantBySku.get(item.sku);
      if (!variant) {
        throw new Error(`Missing seeded variant for sku ${item.sku}`);
      }

      await prisma.purchaseOrderItem.upsert({
        where: { id: item.id },
        update: {
          purchaseOrderId: purchaseOrder.id,
          variantId: variant.id,
          quantityOrdered: item.quantityOrdered,
          quantityReceived: item.quantityReceived,
          unitCostPence: item.unitCostPence,
        },
        create: {
          id: item.id,
          purchaseOrderId: purchaseOrder.id,
          variantId: variant.id,
          quantityOrdered: item.quantityOrdered,
          quantityReceived: item.quantityReceived,
          unitCostPence: item.unitCostPence,
        },
      });
    }
  }
};

const seedDemoSales = async (
  variantBySku: Map<string, { id: string; productId: string; retailPricePence: number }>,
) => {
  const location = await ensureMainLocation();
  const users = await prisma.user.findMany({
    where: {
      username: {
        in: ["admin", "manager", "staff"],
      },
    },
    select: {
      id: true,
      username: true,
    },
  });
  const userByUsername = new Map(users.map((user) => [user.username, user.id]));

  await toReceiptSettings();
  const settings = await prisma.receiptSettings.findUnique({
    where: { id: 1 },
  });
  if (!settings) {
    throw new Error("Unable to load receipt settings during seed.");
  }

  for (const sale of DEMO_SALES) {
    const resolvedItems = sale.items.map((item) => {
      const variant = variantBySku.get(item.sku);
      if (!variant) {
        throw new Error(`Missing seeded variant for sku ${item.sku}`);
      }
      return {
        ...item,
        variantId: variant.id,
        unitPricePence: variant.retailPricePence,
        lineTotalPence: variant.retailPricePence * item.quantity,
      };
    });

    const subtotalPence = resolvedItems.reduce((sum, item) => sum + item.lineTotalPence, 0);
    const totalPence = subtotalPence;
    const tenderedPence = (sale.tenders ?? []).reduce((sum, tender) => sum + tender.amountPence, 0);
    const changeDuePence = sale.completed ? Math.max(0, tenderedPence - totalPence) : 0;
    const createdByStaffId = userByUsername.get(sale.createdByUsername) ?? null;
    const completedAt = sale.completed && sale.completedAt ? new Date(sale.completedAt) : null;

    await prisma.basket.upsert({
      where: { id: sale.basketId },
      update: {
        status: sale.completed ? "CHECKED_OUT" : "OPEN",
      },
      create: {
        id: sale.basketId,
        status: sale.completed ? "CHECKED_OUT" : "OPEN",
      },
    });

    await prisma.sale.upsert({
      where: { id: sale.id },
      update: {
        basketId: sale.basketId,
        customerId: sale.customerId,
        locationId: location.id,
        subtotalPence,
        taxPence: 0,
        totalPence,
        changeDuePence,
        completedAt,
        receiptNumber: sale.completed ? sale.receiptNumber ?? null : null,
        createdByStaffId,
      },
      create: {
        id: sale.id,
        basketId: sale.basketId,
        customerId: sale.customerId,
        locationId: location.id,
        subtotalPence,
        taxPence: 0,
        totalPence,
        changeDuePence,
        completedAt,
        receiptNumber: sale.completed ? sale.receiptNumber ?? null : null,
        createdByStaffId,
      },
    });

    await prisma.basketItem.deleteMany({ where: { basketId: sale.basketId } });
    if (!sale.completed) {
      for (const item of resolvedItems) {
        await prisma.basketItem.upsert({
          where: { id: item.id },
          update: {
            basketId: sale.basketId,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: item.unitPricePence,
          },
          create: {
            id: item.id,
            basketId: sale.basketId,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: item.unitPricePence,
          },
        });
      }
    }

    await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
    for (const item of resolvedItems) {
      await prisma.saleItem.upsert({
        where: { id: item.id },
        update: {
          saleId: sale.id,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPricePence: item.unitPricePence,
          lineTotalPence: item.lineTotalPence,
        },
        create: {
          id: item.id,
          saleId: sale.id,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPricePence: item.unitPricePence,
          lineTotalPence: item.lineTotalPence,
        },
      });
    }

    await prisma.saleTender.deleteMany({ where: { saleId: sale.id } });
    if (sale.completed && sale.tenders && sale.tenders.length > 0) {
      for (const tender of sale.tenders) {
        await prisma.saleTender.upsert({
          where: { id: tender.id },
          update: {
            saleId: sale.id,
            method: tender.method,
            amountPence: tender.amountPence,
            createdByStaffId,
          },
          create: {
            id: tender.id,
            saleId: sale.id,
            method: tender.method,
            amountPence: tender.amountPence,
            createdByStaffId,
          },
        });
      }
    }

    await prisma.payment.deleteMany({ where: { saleId: sale.id } });
    if (sale.completed && sale.payments && sale.payments.length > 0) {
      for (const payment of sale.payments) {
        await prisma.payment.upsert({
          where: { id: payment.id },
          update: {
            saleId: sale.id,
            method: payment.method,
            purpose: "FINAL",
            status: "COMPLETED",
            amountPence: payment.amountPence,
            providerRef: payment.providerRef ?? null,
          },
          create: {
            id: payment.id,
            saleId: sale.id,
            method: payment.method,
            purpose: "FINAL",
            status: "COMPLETED",
            amountPence: payment.amountPence,
            providerRef: payment.providerRef ?? null,
          },
        });
      }
    }

    if (sale.completed && sale.receiptNumber) {
      await prisma.receipt.upsert({
        where: { saleId: sale.id },
        update: {
          receiptNumber: sale.receiptNumber,
          issuedByStaffId: createdByStaffId,
          shopName: settings.shopName,
          shopAddress: settings.shopAddress,
          vatNumber: settings.vatNumber,
          footerText: settings.footerText,
        },
        create: {
          saleId: sale.id,
          receiptNumber: sale.receiptNumber,
          issuedByStaffId: createdByStaffId,
          shopName: settings.shopName,
          shopAddress: settings.shopAddress,
          vatNumber: settings.vatNumber,
          footerText: settings.footerText,
        },
      });
    } else {
      await prisma.receipt.deleteMany({
        where: { saleId: sale.id },
      });
    }
  }
};

const seedDemoWebOrders = async (
  variantBySku: Map<string, { id: string; productId: string; retailPricePence: number }>,
) => {
  for (const order of DEMO_WEB_ORDERS) {
    const resolvedItems = order.items.map((item) => {
      const variant = variantBySku.get(item.sku);
      if (!variant) {
        throw new Error(`Missing seeded variant for sku ${item.sku}`);
      }

      const product = DEMO_PRODUCTS.find((candidate) => candidate.sku === item.sku);
      if (!product) {
        throw new Error(`Missing seeded product definition for sku ${item.sku}`);
      }

      return {
        id: item.id,
        variantId: variant.id,
        sku: item.sku,
        productName: product.name,
        variantName: product.name,
        quantity: item.quantity,
        unitPricePence: variant.retailPricePence,
        lineTotalPence: variant.retailPricePence * item.quantity,
      };
    });

    const subtotalPence = resolvedItems.reduce((sum, item) => sum + item.lineTotalPence, 0);

    await prisma.webOrder.upsert({
      where: { id: order.id },
      update: {
        orderNumber: order.orderNumber,
        sourceChannel: order.sourceChannel,
        externalOrderRef: order.externalOrderRef,
        customerId: order.customerId,
        status: order.status,
        fulfillmentMethod: order.fulfillmentMethod,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        deliveryInstructions: order.deliveryInstructions,
        shippingRecipientName: order.shippingRecipientName,
        shippingAddressLine1: order.shippingAddressLine1,
        shippingAddressLine2: order.shippingAddressLine2,
        shippingCity: order.shippingCity,
        shippingRegion: order.shippingRegion,
        shippingPostcode: order.shippingPostcode,
        shippingCountry: order.shippingCountry,
        subtotalPence,
        shippingPricePence: order.shippingPricePence,
        totalPence: subtotalPence + order.shippingPricePence,
        placedAt: new Date(order.placedAt),
        packedAt: order.packedAt ? new Date(order.packedAt) : null,
      },
      create: {
        id: order.id,
        orderNumber: order.orderNumber,
        sourceChannel: order.sourceChannel,
        externalOrderRef: order.externalOrderRef,
        customerId: order.customerId,
        status: order.status,
        fulfillmentMethod: order.fulfillmentMethod,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        deliveryInstructions: order.deliveryInstructions,
        shippingRecipientName: order.shippingRecipientName,
        shippingAddressLine1: order.shippingAddressLine1,
        shippingAddressLine2: order.shippingAddressLine2,
        shippingCity: order.shippingCity,
        shippingRegion: order.shippingRegion,
        shippingPostcode: order.shippingPostcode,
        shippingCountry: order.shippingCountry,
        subtotalPence,
        shippingPricePence: order.shippingPricePence,
        totalPence: subtotalPence + order.shippingPricePence,
        placedAt: new Date(order.placedAt),
        packedAt: order.packedAt ? new Date(order.packedAt) : null,
      },
    });

    await prisma.webOrderShipment.deleteMany({
      where: { webOrderId: order.id },
    });
    await prisma.webOrderItem.deleteMany({
      where: { webOrderId: order.id },
    });
    await prisma.webOrderItem.createMany({
      data: resolvedItems.map((item) => ({
        id: item.id,
        webOrderId: order.id,
        variantId: item.variantId,
        sku: item.sku,
        productName: item.productName,
        variantName: item.variantName,
        quantity: item.quantity,
        unitPricePence: item.unitPricePence,
        lineTotalPence: item.lineTotalPence,
      })),
    });
  }
};

const run = async () => {
  await removeLegacyDemoUsers();
  const variantBySku = await seedDemoProducts();
  await seedDemoCustomers();
  await seedDemoOpeningStock(variantBySku);
  await seedDemoWorkshopJobs(variantBySku);
  await seedDemoWorkshopServiceTemplates();
  await seedDemoSuppliers();
  await seedDemoPurchaseOrders(variantBySku);
  await seedDemoSales(variantBySku);
  await seedDemoWebOrders(variantBySku);
  await seedDemoDispatchPrinters();
  await createThomasAdmin();

  console.log("Demo seed ready:");
  console.log("- admin login user Thomas (username: thomas, PIN: 9999) is ready");
  console.log(`- ${DEMO_PRODUCTS.length} products with opening stock in ${DEMO_STOCK_LOCATION.name}`);
  console.log(`- ${DEMO_CUSTOMERS.length} customers`);
  console.log(`- ${DEMO_WORKSHOP_JOBS.length} workshop jobs`);
  console.log(`- ${DEMO_WORKSHOP_SERVICE_TEMPLATES.length} workshop service templates`);
  console.log(`- ${DEMO_SUPPLIERS.length} supplier and ${DEMO_PURCHASE_ORDERS.length} open purchase order`);
  console.log(`- ${DEMO_WEB_ORDERS.length} demo web orders for shipment-label dispatch testing`);
  console.log(`- ${DEMO_DISPATCH_PRINTERS.length} registered dispatch printer with a default shipping-label target`);
  console.log("Existing local staff accounts are preserved and Thomas is upserted idempotently.");
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
