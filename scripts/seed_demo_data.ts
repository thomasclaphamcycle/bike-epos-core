import "dotenv/config";

import { Prisma, PrismaClient, UserRole, WorkshopJobStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/services/passwordService";

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

const DEMO_USERS = [
  {
    username: "admin",
    email: "admin@local",
    name: "Demo Admin",
    role: "ADMIN" as UserRole,
    password: "admin123",
  },
  {
    username: "manager",
    email: "manager@local",
    name: "Demo Manager",
    role: "MANAGER" as UserRole,
    password: "manager123",
  },
  {
    username: "staff",
    email: "staff@local",
    name: "Demo Staff",
    role: "STAFF" as UserRole,
    password: "staff123",
  },
];

const DEMO_PRODUCTS: DemoProduct[] = [
  {
    name: "Demo Road Bike 54cm",
    brand: "CoreCycles",
    description: "Aluminium road bike with Shimano Tiagra.",
    sku: "DEMO-BIKE-R54",
    barcode: "9900000000001",
    retailPricePence: 109999,
    costPricePence: 76000,
  },
  {
    name: "Demo Gravel Bike 56cm",
    brand: "CoreCycles",
    description: "Gravel bike with hydraulic disc brakes.",
    sku: "DEMO-BIKE-G56",
    barcode: "9900000000002",
    retailPricePence: 139999,
    costPricePence: 99000,
  },
  {
    name: "Demo City Bike 52cm",
    brand: "MetroRide",
    description: "Step-through city bike.",
    sku: "DEMO-BIKE-C52",
    barcode: "9900000000003",
    retailPricePence: 74999,
    costPricePence: 51000,
  },
  {
    name: "Demo MTB Hardtail M",
    brand: "TrailForge",
    description: "Hardtail mountain bike, 29 inch wheels.",
    sku: "DEMO-BIKE-MTB-M",
    barcode: "9900000000004",
    retailPricePence: 124999,
    costPricePence: 88000,
  },
  {
    name: "Demo Helmet Road",
    brand: "SafeLine",
    description: "Lightweight road helmet.",
    sku: "DEMO-ACC-HELMET",
    barcode: "9900000000005",
    retailPricePence: 5999,
    costPricePence: 3100,
  },
  {
    name: "Demo Cycling Gloves",
    brand: "GripMax",
    description: "Half-finger summer gloves.",
    sku: "DEMO-ACC-GLOVES",
    barcode: "9900000000006",
    retailPricePence: 2499,
    costPricePence: 1200,
  },
  {
    name: "Demo Floor Pump",
    brand: "AirFlow",
    description: "Workshop floor pump with pressure gauge.",
    sku: "DEMO-ACC-PUMP",
    barcode: "9900000000007",
    retailPricePence: 3499,
    costPricePence: 1800,
  },
  {
    name: "Demo Bottle Cage",
    brand: "Hydra",
    description: "Alloy bottle cage.",
    sku: "DEMO-ACC-CAGE",
    barcode: "9900000000008",
    retailPricePence: 1299,
    costPricePence: 500,
  },
  {
    name: "Demo Chain 11-Speed",
    brand: "DriveTech",
    description: "11-speed chain for road and gravel.",
    sku: "DEMO-PART-CHAIN11",
    barcode: "9900000000009",
    retailPricePence: 2799,
    costPricePence: 1500,
  },
  {
    name: "Demo Cassette 11-30",
    brand: "DriveTech",
    description: "11-speed cassette 11-30T.",
    sku: "DEMO-PART-CASS1130",
    barcode: "9900000000010",
    retailPricePence: 4599,
    costPricePence: 2900,
  },
  {
    name: "Demo Disc Rotor 160mm",
    brand: "StopFast",
    description: "160mm centre-lock disc rotor.",
    sku: "DEMO-PART-ROTOR160",
    barcode: "9900000000011",
    retailPricePence: 2199,
    costPricePence: 1200,
  },
  {
    name: "Demo Brake Pads Resin",
    brand: "StopFast",
    description: "Resin hydraulic disc brake pads.",
    sku: "DEMO-PART-PADS-R",
    barcode: "9900000000012",
    retailPricePence: 1499,
    costPricePence: 700,
  },
  {
    name: "Demo Inner Tube 700x25-32",
    brand: "AirFlow",
    description: "Road inner tube 700x25-32 presta.",
    sku: "DEMO-PART-TUBE700",
    barcode: "9900000000013",
    retailPricePence: 699,
    costPricePence: 300,
  },
  {
    name: "Demo Tyre 700x28",
    brand: "GripMax",
    description: "Puncture-resistant road tyre 700x28.",
    sku: "DEMO-PART-TYRE728",
    barcode: "9900000000014",
    retailPricePence: 3299,
    costPricePence: 1900,
  },
  {
    name: "Demo Chain Lube 120ml",
    brand: "SmoothRide",
    description: "All-weather chain lubricant.",
    sku: "DEMO-ACC-LUBE",
    barcode: "9900000000015",
    retailPricePence: 899,
    costPricePence: 400,
  },
  {
    name: "Demo Multi-Tool 15-in-1",
    brand: "FixKit",
    description: "Compact roadside multi-tool.",
    sku: "DEMO-ACC-TOOL15",
    barcode: "9900000000016",
    retailPricePence: 2499,
    costPricePence: 1200,
  },
  {
    name: "Demo Pedals Flat Alloy",
    brand: "TrailForge",
    description: "Flat MTB pedals in alloy.",
    sku: "DEMO-PART-PEDALFLAT",
    barcode: "9900000000017",
    retailPricePence: 2899,
    costPricePence: 1700,
  },
  {
    name: "Demo Saddle Comfort",
    brand: "RideWell",
    description: "Comfort saddle with gel insert.",
    sku: "DEMO-PART-SADDLE-C",
    barcode: "9900000000018",
    retailPricePence: 3199,
    costPricePence: 1800,
  },
  {
    name: "Demo Light Set USB",
    brand: "BeamBright",
    description: "USB rechargeable front/rear light set.",
    sku: "DEMO-ACC-LIGHTS-USB",
    barcode: "9900000000019",
    retailPricePence: 3999,
    costPricePence: 2200,
  },
  {
    name: "Demo Lock U-Lock",
    brand: "SecureRide",
    description: "Hardened steel U-lock.",
    sku: "DEMO-ACC-ULOCK",
    barcode: "9900000000020",
    retailPricePence: 4599,
    costPricePence: 2500,
  },
];

const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Alex Turner",
    firstName: "Alex",
    lastName: "Turner",
    email: "alex.turner@demo.local",
    phone: "07700000001",
    notes: "Demo customer profile for POS walkthroughs.",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Jordan Patel",
    firstName: "Jordan",
    lastName: "Patel",
    email: "jordan.patel@demo.local",
    phone: "07700000002",
    notes: "Prefers phone updates for service work.",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Morgan Lee",
    firstName: "Morgan",
    lastName: "Lee",
    email: "morgan.lee@demo.local",
    phone: "07700000003",
    notes: "Interested in commuter upgrades.",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Taylor Smith",
    firstName: "Taylor",
    lastName: "Smith",
    email: "taylor.smith@demo.local",
    phone: "07700000004",
    notes: "Collects accessories frequently.",
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    name: "Riley Evans",
    firstName: "Riley",
    lastName: "Evans",
    email: "riley.evans@demo.local",
    phone: "07700000005",
    notes: "Demo workshop customer.",
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    name: "Casey Walker",
    firstName: "Casey",
    lastName: "Walker",
    email: "casey.walker@demo.local",
    phone: "07700000006",
    notes: "High-value customer account.",
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    name: "Jamie Green",
    firstName: "Jamie",
    lastName: "Green",
    email: "jamie.green@demo.local",
    phone: "07700000007",
    notes: "Orders parts in advance.",
  },
  {
    id: "10000000-0000-4000-8000-000000000008",
    name: "Sam Johnson",
    firstName: "Sam",
    lastName: "Johnson",
    email: "sam.johnson@demo.local",
    phone: "07700000008",
    notes: "Interested in gravel bikes.",
  },
  {
    id: "10000000-0000-4000-8000-000000000009",
    name: "Drew Kim",
    firstName: "Drew",
    lastName: "Kim",
    email: "drew.kim@demo.local",
    phone: "07700000009",
    notes: "Workshop repeat customer.",
  },
  {
    id: "10000000-0000-4000-8000-000000000010",
    name: "Avery Lewis",
    firstName: "Avery",
    lastName: "Lewis",
    email: "avery.lewis@demo.local",
    phone: "07700000010",
    notes: "Prefers card payments.",
  },
];

const DEMO_WORKSHOP_JOBS: DemoWorkshopJob[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    customerId: DEMO_CUSTOMERS[0].id,
    customerName: DEMO_CUSTOMERS[0].name,
    bikeDescription: "CoreCycles Road Bike - brake rub",
    status: "BOOKING_MADE",
    notes: "[DEMO_SEED:M67:JOB:001] Awaiting bike drop-off.",
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
    customerId: DEMO_CUSTOMERS[1].id,
    customerName: DEMO_CUSTOMERS[1].name,
    bikeDescription: "MetroRide City Bike - puncture repair",
    status: "BIKE_ARRIVED",
    notes: "[DEMO_SEED:M67:JOB:002] In workshop queue.",
    line: {
      id: "21000000-0000-4000-8000-000000000002",
      type: "PART",
      description: "Replace inner tube",
      qty: 1,
      unitPricePence: 699,
      sku: "DEMO-PART-TUBE700",
    },
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    customerId: DEMO_CUSTOMERS[2].id,
    customerName: DEMO_CUSTOMERS[2].name,
    bikeDescription: "TrailForge MTB - drivetrain noise",
    status: "WAITING_FOR_APPROVAL",
    notes: "[DEMO_SEED:M67:JOB:003] Waiting customer approval.",
    line: {
      id: "21000000-0000-4000-8000-000000000003",
      type: "LABOUR",
      description: "Drivetrain diagnostic",
      qty: 1,
      unitPricePence: 3000,
    },
  },
  {
    id: "20000000-0000-4000-8000-000000000004",
    customerId: DEMO_CUSTOMERS[3].id,
    customerName: DEMO_CUSTOMERS[3].name,
    bikeDescription: "Gravel bike - full service",
    status: "APPROVED",
    notes: "[DEMO_SEED:M67:JOB:004] Approved and queued.",
    line: {
      id: "21000000-0000-4000-8000-000000000004",
      type: "LABOUR",
      description: "Full service labour",
      qty: 2,
      unitPricePence: 4500,
    },
  },
  {
    id: "20000000-0000-4000-8000-000000000005",
    customerId: DEMO_CUSTOMERS[4].id,
    customerName: DEMO_CUSTOMERS[4].name,
    bikeDescription: "Road bike - waiting on cassette",
    status: "WAITING_FOR_PARTS",
    notes: "[DEMO_SEED:M67:JOB:005] Waiting for part delivery.",
    line: {
      id: "21000000-0000-4000-8000-000000000005",
      type: "PART",
      description: "Install cassette 11-30",
      qty: 1,
      unitPricePence: 4599,
      sku: "DEMO-PART-CASS1130",
    },
  },
  {
    id: "20000000-0000-4000-8000-000000000006",
    customerId: DEMO_CUSTOMERS[5].id,
    customerName: DEMO_CUSTOMERS[5].name,
    bikeDescription: "Commuter bike - brake pads + tune",
    status: "ON_HOLD",
    notes: "[DEMO_SEED:M67:JOB:006] Customer requested hold.",
    line: {
      id: "21000000-0000-4000-8000-000000000006",
      type: "PART",
      description: "Replace brake pads",
      qty: 1,
      unitPricePence: 1499,
      sku: "DEMO-PART-PADS-R",
    },
  },
  {
    id: "20000000-0000-4000-8000-000000000007",
    customerId: DEMO_CUSTOMERS[6].id,
    customerName: DEMO_CUSTOMERS[6].name,
    bikeDescription: "Road bike - ready for collection",
    status: "BIKE_READY",
    notes: "[DEMO_SEED:M67:JOB:007] Ready and awaiting collection.",
    line: {
      id: "21000000-0000-4000-8000-000000000007",
      type: "LABOUR",
      description: "Wheel truing labour",
      qty: 1,
      unitPricePence: 2200,
    },
  },
  {
    id: "20000000-0000-4000-8000-000000000008",
    customerId: DEMO_CUSTOMERS[7].id,
    customerName: DEMO_CUSTOMERS[7].name,
    bikeDescription: "MTB - service completed",
    status: "COMPLETED",
    notes: "[DEMO_SEED:M67:JOB:008] Completed service.",
    line: {
      id: "21000000-0000-4000-8000-000000000008",
      type: "LABOUR",
      description: "Suspension setup labour",
      qty: 1,
      unitPricePence: 5000,
    },
  },
];

const DEMO_SALES: DemoSale[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    basketId: "31000000-0000-4000-8000-000000000001",
    customerId: DEMO_CUSTOMERS[0].id,
    createdByUsername: "staff",
    completed: false,
    items: [
      { id: "32000000-0000-4000-8000-000000000001", sku: "DEMO-ACC-HELMET", quantity: 1 },
      { id: "32000000-0000-4000-8000-000000000002", sku: "DEMO-ACC-GLOVES", quantity: 1 },
    ],
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    basketId: "31000000-0000-4000-8000-000000000002",
    customerId: DEMO_CUSTOMERS[1].id,
    createdByUsername: "staff",
    completed: false,
    items: [
      { id: "32000000-0000-4000-8000-000000000003", sku: "DEMO-ACC-PUMP", quantity: 1 },
      { id: "32000000-0000-4000-8000-000000000004", sku: "DEMO-ACC-CAGE", quantity: 2 },
    ],
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    basketId: "31000000-0000-4000-8000-000000000003",
    customerId: DEMO_CUSTOMERS[2].id,
    createdByUsername: "manager",
    completed: true,
    completedAt: "2026-03-01T10:15:00.000Z",
    receiptNumber: "DEMO-REC-0001",
    tenders: [{ id: "33000000-0000-4000-8000-000000000001", method: "CASH", amountPence: 6098 }],
    payments: [{ id: "34000000-0000-4000-8000-000000000001", method: "CASH", amountPence: 6098 }],
    items: [
      { id: "32000000-0000-4000-8000-000000000005", sku: "DEMO-PART-CHAIN11", quantity: 1 },
      { id: "32000000-0000-4000-8000-000000000006", sku: "DEMO-PART-PADS-R", quantity: 2 },
    ],
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    basketId: "31000000-0000-4000-8000-000000000004",
    customerId: DEMO_CUSTOMERS[3].id,
    createdByUsername: "manager",
    completed: true,
    completedAt: "2026-03-02T14:40:00.000Z",
    receiptNumber: "DEMO-REC-0002",
    tenders: [{ id: "33000000-0000-4000-8000-000000000002", method: "CARD", amountPence: 3999 }],
    payments: [
      {
        id: "34000000-0000-4000-8000-000000000002",
        method: "CARD",
        amountPence: 3999,
        providerRef: "DEMO-CARD-0002",
      },
    ],
    items: [{ id: "32000000-0000-4000-8000-000000000007", sku: "DEMO-ACC-LIGHTS-USB", quantity: 1 }],
  },
  {
    id: "30000000-0000-4000-8000-000000000005",
    basketId: "31000000-0000-4000-8000-000000000005",
    customerId: DEMO_CUSTOMERS[4].id,
    createdByUsername: "admin",
    completed: true,
    completedAt: "2026-03-03T11:25:00.000Z",
    receiptNumber: "DEMO-REC-0003",
    tenders: [{ id: "33000000-0000-4000-8000-000000000003", method: "CARD", amountPence: 11498 }],
    payments: [
      {
        id: "34000000-0000-4000-8000-000000000003",
        method: "CARD",
        amountPence: 11498,
        providerRef: "DEMO-CARD-0003",
      },
    ],
    items: [
      { id: "32000000-0000-4000-8000-000000000008", sku: "DEMO-ACC-ULOCK", quantity: 1 },
      { id: "32000000-0000-4000-8000-000000000009", sku: "DEMO-ACC-TOOL15", quantity: 1 },
      { id: "32000000-0000-4000-8000-000000000010", sku: "DEMO-ACC-LUBE", quantity: 1 },
    ],
  },
  {
    id: "30000000-0000-4000-8000-000000000006",
    basketId: "31000000-0000-4000-8000-000000000006",
    customerId: DEMO_CUSTOMERS[5].id,
    createdByUsername: "admin",
    completed: true,
    completedAt: "2026-03-04T16:55:00.000Z",
    receiptNumber: "DEMO-REC-0004",
    tenders: [{ id: "33000000-0000-4000-8000-000000000004", method: "CASH", amountPence: 74999 }],
    payments: [{ id: "34000000-0000-4000-8000-000000000004", method: "CASH", amountPence: 74999 }],
    items: [{ id: "32000000-0000-4000-8000-000000000011", sku: "DEMO-BIKE-C52", quantity: 1 }],
  },
];

const toReceiptSettings = async () => {
  await prisma.receiptSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      shopName: "CorePOS Demo Store",
      shopAddress: "1 Demo High Street",
      footerText: "Thanks for riding with CorePOS.",
    },
    update: {},
  });
};

const seedDemoUsers = async () => {
  for (const user of DEMO_USERS) {
    const passwordHash = await hashPassword(user.password);
    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: true,
        passwordHash,
      },
      create: {
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: true,
        passwordHash,
      },
    });
  }
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
        type: "INTERNAL",
        isPrimary: true,
      },
    });

    variantBySku.set(product.sku, variant);
  }

  return variantBySku;
};

const seedDemoCustomers = async () => {
  for (const customer of DEMO_CUSTOMERS) {
    await prisma.customer.upsert({
      where: { id: customer.id },
      update: {
        name: customer.name,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        notes: customer.notes,
      },
      create: {
        id: customer.id,
        name: customer.name,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        notes: customer.notes,
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

const seedDemoSales = async (
  variantBySku: Map<string, { id: string; productId: string; retailPricePence: number }>,
) => {
  const users = await prisma.user.findMany({
    where: {
      username: {
        in: DEMO_USERS.map((user) => user.username),
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
      await prisma.basketItem.createMany({
        data: resolvedItems.map((item) => ({
          id: item.id,
          basketId: sale.basketId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPricePence,
        })),
      });
    }

    await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
    await prisma.saleItem.createMany({
      data: resolvedItems.map((item) => ({
        id: item.id,
        saleId: sale.id,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPricePence: item.unitPricePence,
        lineTotalPence: item.lineTotalPence,
      })),
    });

    await prisma.saleTender.deleteMany({ where: { saleId: sale.id } });
    if (sale.completed && sale.tenders && sale.tenders.length > 0) {
      await prisma.saleTender.createMany({
        data: sale.tenders.map((tender) => ({
          id: tender.id,
          saleId: sale.id,
          method: tender.method,
          amountPence: tender.amountPence,
          createdByStaffId,
        })),
      });
    }

    await prisma.payment.deleteMany({ where: { saleId: sale.id } });
    if (sale.completed && sale.payments && sale.payments.length > 0) {
      await prisma.payment.createMany({
        data: sale.payments.map((payment) => ({
          id: payment.id,
          saleId: sale.id,
          method: payment.method,
          purpose: "FINAL",
          status: "COMPLETED",
          amountPence: payment.amountPence,
          providerRef: payment.providerRef ?? null,
        })),
      });
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

const run = async () => {
  await seedDemoUsers();
  const variantBySku = await seedDemoProducts();
  await seedDemoCustomers();
  await seedDemoWorkshopJobs(variantBySku);
  await seedDemoSales(variantBySku);

  console.log("Demo users created:");
  console.log("admin / admin123");
  console.log("manager / manager123");
  console.log("staff / staff123");
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
