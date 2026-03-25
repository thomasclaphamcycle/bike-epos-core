#!/usr/bin/env node
require('dotenv/config');
require('ts-node/register/transpile-only');

const { Prisma, UserRole, WorkshopJobLineType } = require('@prisma/client');
const { prisma } = require('../src/lib/prisma');
const { ensureDefaultLocation } = require('../src/services/locationService');
const { hashPassword } = require('../src/services/passwordService');
const { issueReceipt } = require('../src/services/receiptService');

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const modeValue = modeArg ? modeArg.split('=')[1].trim().toLowerCase() : 'dev';
const mode = modeValue === 'test' ? 'test' : 'dev';
const seedTag = `[m67-demo-${mode}]`;

const DEMO_USERS = [
  { username: 'admin', email: 'admin@local', name: 'Demo Admin', role: UserRole.ADMIN, password: 'admin123' },
  { username: 'manager', email: 'manager@local', name: 'Demo Manager', role: UserRole.MANAGER, password: 'manager123' },
  { username: 'staff', email: 'staff@local', name: 'Demo Staff', role: UserRole.STAFF, password: 'staff123' },
];

const DEMO_PRODUCTS = [
  { key: 'city-bike-1', productName: 'City Commuter 700c', brand: 'CoreCycles', description: 'Comfort commuter bike', variantName: 'Medium Graphite', sku: 'DEMO-BIKE-001', barcode: '9900000000011', pricePence: 54999, stockQty: 4 },
  { key: 'city-bike-2', productName: 'City Commuter 700c', brand: 'CoreCycles', description: 'Comfort commuter bike', variantName: 'Large Graphite', sku: 'DEMO-BIKE-002', barcode: '9900000000028', pricePence: 54999, stockQty: 3 },
  { key: 'road-bike-1', productName: 'Road Sprint', brand: 'CoreCycles', description: 'Entry road bike', variantName: '54cm Red', sku: 'DEMO-BIKE-003', barcode: '9900000000035', pricePence: 89999, stockQty: 2 },
  { key: 'hybrid-bike-1', productName: 'Hybrid Metro', brand: 'CoreCycles', description: 'Fast city hybrid', variantName: 'Medium Blue', sku: 'DEMO-BIKE-004', barcode: '9900000000042', pricePence: 69999, stockQty: 3 },
  { key: 'mtb-bike-1', productName: 'Trail Hiker', brand: 'CoreCycles', description: 'Hardtail MTB', variantName: '29er Black', sku: 'DEMO-BIKE-005', barcode: '9900000000059', pricePence: 94999, stockQty: 2 },
  { key: 'tube-1', productName: 'Inner Tube', brand: 'RidePro', description: '700x25-32 presta tube', variantName: '700x25-32', sku: 'DEMO-PART-001', barcode: '9900000000066', pricePence: 699, stockQty: 60 },
  { key: 'tube-2', productName: 'Inner Tube', brand: 'RidePro', description: '27.5 MTB tube', variantName: '27.5x2.1', sku: 'DEMO-PART-002', barcode: '9900000000073', pricePence: 799, stockQty: 40 },
  { key: 'chain-1', productName: '11-Speed Chain', brand: 'DriveLine', description: 'Road/Gravel chain', variantName: '116 link', sku: 'DEMO-PART-003', barcode: '9900000000080', pricePence: 2799, stockQty: 20 },
  { key: 'cassette-1', productName: 'Cassette 11-32', brand: 'DriveLine', description: '11-speed cassette', variantName: '11-32T', sku: 'DEMO-PART-004', barcode: '9900000000097', pricePence: 4599, stockQty: 12 },
  { key: 'brake-pad-1', productName: 'Disc Brake Pads', brand: 'StopRight', description: 'Resin pad set', variantName: 'SR-01', sku: 'DEMO-PART-005', barcode: '9900000000103', pricePence: 1599, stockQty: 30 },
  { key: 'brake-pad-2', productName: 'Disc Brake Pads', brand: 'StopRight', description: 'Metallic pad set', variantName: 'SR-02', sku: 'DEMO-PART-006', barcode: '9900000000110', pricePence: 1999, stockQty: 18 },
  { key: 'chain-lube', productName: 'Chain Lube', brand: 'RideCare', description: 'Wet conditions lube', variantName: '120ml', sku: 'DEMO-PART-007', barcode: '9900000000127', pricePence: 899, stockQty: 45 },
  { key: 'grip-tape', productName: 'Handlebar Tape', brand: 'GripMax', description: 'Cushioned tape roll', variantName: 'Black', sku: 'DEMO-PART-008', barcode: '9900000000134', pricePence: 1499, stockQty: 22 },
  { key: 'helmet-1', productName: 'Urban Helmet', brand: 'SafeRide', description: 'Certified commuter helmet', variantName: 'M Matte Black', sku: 'DEMO-ACC-001', barcode: '9900000000141', pricePence: 3999, stockQty: 15 },
  { key: 'helmet-2', productName: 'Urban Helmet', brand: 'SafeRide', description: 'Certified commuter helmet', variantName: 'L Matte White', sku: 'DEMO-ACC-002', barcode: '9900000000158', pricePence: 3999, stockQty: 12 },
  { key: 'light-front', productName: 'Front Light', brand: 'NightBeam', description: 'USB rechargeable 500lm', variantName: 'NB-500', sku: 'DEMO-ACC-003', barcode: '9900000000165', pricePence: 2499, stockQty: 25 },
  { key: 'light-rear', productName: 'Rear Light', brand: 'NightBeam', description: 'USB rechargeable rear light', variantName: 'NB-R120', sku: 'DEMO-ACC-004', barcode: '9900000000172', pricePence: 1799, stockQty: 25 },
  { key: 'lock-1', productName: 'D-Lock', brand: 'SecureRide', description: 'Gold rated lock', variantName: 'Mini D', sku: 'DEMO-ACC-005', barcode: '9900000000189', pricePence: 4499, stockQty: 14 },
  { key: 'pump-1', productName: 'Floor Pump', brand: 'AirForce', description: 'Workshop floor pump', variantName: 'AF-200', sku: 'DEMO-ACC-006', barcode: '9900000000196', pricePence: 2999, stockQty: 10 },
  { key: 'bottle-1', productName: 'Water Bottle', brand: 'HydroRide', description: '750ml cycling bottle', variantName: 'Clear', sku: 'DEMO-ACC-007', barcode: '9900000000202', pricePence: 699, stockQty: 35 },
];

const DEMO_CUSTOMERS = [
  { id: '00000000-0000-0000-0000-000000000201', firstName: 'Alex', lastName: 'Rider', email: 'alex.rider@demo.local', phone: '0700000001', notes: `${seedTag} Weekly commuter service plan` },
  { id: '00000000-0000-0000-0000-000000000202', firstName: 'Mia', lastName: 'Lane', email: 'mia.lane@demo.local', phone: '0700000002', notes: `${seedTag} Family bike purchase` },
  { id: '00000000-0000-0000-0000-000000000203', firstName: 'Noah', lastName: 'Turner', email: 'noah.turner@demo.local', phone: '0700000003', notes: `${seedTag} Road race customer` },
  { id: '00000000-0000-0000-0000-000000000204', firstName: 'Ivy', lastName: 'Cooper', email: 'ivy.cooper@demo.local', phone: '0700000004', notes: `${seedTag} Workshop repeat customer` },
  { id: '00000000-0000-0000-0000-000000000205', firstName: 'Leo', lastName: 'Bennett', email: 'leo.bennett@demo.local', phone: '0700000005', notes: `${seedTag} MTB enthusiast` },
  { id: '00000000-0000-0000-0000-000000000206', firstName: 'Emma', lastName: 'Shaw', email: 'emma.shaw@demo.local', phone: '0700000006', notes: `${seedTag} New commuter rider` },
  { id: '00000000-0000-0000-0000-000000000207', firstName: 'Jack', lastName: 'Mills', email: 'jack.mills@demo.local', phone: '0700000007', notes: `${seedTag} Fleet maintenance account` },
  { id: '00000000-0000-0000-0000-000000000208', firstName: 'Ruby', lastName: 'Hart', email: 'ruby.hart@demo.local', phone: '0700000008', notes: `${seedTag} Accessories focused` },
  { id: '00000000-0000-0000-0000-000000000209', firstName: 'Owen', lastName: 'Pike', email: 'owen.pike@demo.local', phone: '0700000009', notes: `${seedTag} Corporate cycle scheme` },
  { id: '00000000-0000-0000-0000-000000000210', firstName: 'Nora', lastName: 'Stone', email: 'nora.stone@demo.local', phone: '0700000010', notes: `${seedTag} Child seat setup` },
];

const DEMO_WORKSHOP_JOBS = [
  {
    id: '00000000-0000-0000-0000-000000000301',
    customerIndex: 0,
    bikeDescription: 'CoreCycles City Commuter - Tune up',
    status: 'IN_PROGRESS',
    notes: `${seedTag} intake and safety check`,
    scheduledOffsetDays: -1,
    lines: [
      { type: 'LABOUR', description: 'Safety inspection', qty: 1, unitPricePence: 2500 },
      { type: 'PART', productKey: 'chain-lube', description: 'Drivetrain lubrication', qty: 1 },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000000302',
    customerIndex: 1,
    bikeDescription: 'Road Sprint - Gear indexing',
    status: 'IN_PROGRESS',
    notes: `${seedTag} actively in workshop`,
    scheduledOffsetDays: 0,
    lines: [
      { type: 'LABOUR', description: 'Gear indexing labour', qty: 1, unitPricePence: 3200 },
      { type: 'PART', productKey: 'chain-1', description: '11-speed replacement chain', qty: 1 },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000000303',
    customerIndex: 2,
    bikeDescription: 'Trail Hiker - Brake refresh',
    status: 'WAITING_FOR_PARTS',
    notes: `${seedTag} waiting for metallic pads`,
    scheduledOffsetDays: 1,
    lines: [
      { type: 'LABOUR', description: 'Brake bleed labour', qty: 1, unitPricePence: 3800 },
      { type: 'PART', productKey: 'brake-pad-2', description: 'Disc pads metallic', qty: 1 },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000000304',
    customerIndex: 3,
    bikeDescription: 'Hybrid Metro - Full service',
    status: 'READY_FOR_COLLECTION',
    notes: `${seedTag} ready for collection`,
    scheduledOffsetDays: -2,
    lines: [
      { type: 'LABOUR', description: 'Full service labour', qty: 1, unitPricePence: 6500 },
      { type: 'PART', productKey: 'tube-1', description: 'Tube replacement', qty: 1 },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000000305',
    customerIndex: 4,
    bikeDescription: 'City Commuter - Puncture repair',
    status: 'COMPLETED',
    notes: `${seedTag} collected and completed`,
    scheduledOffsetDays: -4,
    lines: [
      { type: 'LABOUR', description: 'Puncture repair labour', qty: 1, unitPricePence: 1800 },
      { type: 'PART', productKey: 'tube-1', description: 'Inner tube', qty: 1 },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000000306',
    customerIndex: 5,
    bikeDescription: 'Road Sprint - Bar tape refresh',
    status: 'ON_HOLD',
    notes: `${seedTag} customer requested hold`,
    scheduledOffsetDays: 2,
    lines: [
      { type: 'LABOUR', description: 'Bar tape fitting labour', qty: 1, unitPricePence: 2200 },
      { type: 'PART', productKey: 'grip-tape', description: 'Handlebar tape', qty: 1 },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000000307',
    customerIndex: 6,
    bikeDescription: 'Hybrid Metro - New customer intake',
    status: 'BOOKED',
    notes: `${seedTag} awaiting bike drop-off`,
    scheduledOffsetDays: 3,
    lines: [{ type: 'LABOUR', description: 'Initial diagnostic estimate', qty: 1, unitPricePence: 1500 }],
  },
  {
    id: '00000000-0000-0000-0000-000000000308',
    customerIndex: 7,
    bikeDescription: 'Trail Hiker - Cancelled booking',
    status: 'CANCELLED',
    notes: `${seedTag} cancelled by customer`,
    scheduledOffsetDays: -3,
    lines: [{ type: 'LABOUR', description: 'Cancellation assessment', qty: 1, unitPricePence: 0 }],
  },
];

const DEMO_SALES = [
  {
    id: '11111111-1111-4111-8111-000000000401',
    customerIndex: 0,
    completed: true,
    tenderMethod: 'CARD',
    items: [
      { productKey: 'helmet-1', qty: 1 },
      { productKey: 'light-front', qty: 1 },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000402',
    customerIndex: 1,
    completed: true,
    tenderMethod: 'CASH',
    items: [
      { productKey: 'city-bike-1', qty: 1 },
      { productKey: 'lock-1', qty: 1 },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000403',
    customerIndex: 2,
    completed: true,
    tenderMethod: 'CARD',
    items: [{ productKey: 'tube-1', qty: 2 }],
  },
  {
    id: '11111111-1111-4111-8111-000000000404',
    customerIndex: 3,
    completed: true,
    tenderMethod: 'CARD',
    items: [
      { productKey: 'chain-1', qty: 1 },
      { productKey: 'cassette-1', qty: 1 },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000405',
    customerIndex: 4,
    completed: false,
    tenderMethod: 'CARD',
    items: [{ productKey: 'bottle-1', qty: 2 }],
  },
  {
    id: '11111111-1111-4111-8111-000000000406',
    customerIndex: 5,
    completed: false,
    tenderMethod: 'CASH',
    items: [
      { productKey: 'pump-1', qty: 1 },
      { productKey: 'chain-lube', qty: 1 },
    ],
  },
];

const requireDatabaseUrl = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }
};

const seedUsers = async () => {
  const seededUsers = {};
  for (const user of DEMO_USERS) {
    const passwordHash = await hashPassword(user.password);
    const seeded = await prisma.user.upsert({
      where: { username: user.username },
      create: {
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: true,
        passwordHash,
      },
      update: {
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: true,
        passwordHash,
      },
      select: {
        id: true,
        username: true,
        role: true,
      },
    });
    seededUsers[user.username] = seeded;
  }
  return seededUsers;
};

const seedProducts = async (locationId, createdByStaffId) => {
  const seededByKey = {};

  for (const item of DEMO_PRODUCTS) {
    const productId = `demo-product-${item.key}`;
    const variantId = `demo-variant-${item.key}`;
    const stockMovementId = `demo-stock-${item.key}`;

    await prisma.product.upsert({
      where: { id: productId },
      create: {
        id: productId,
        name: item.productName,
        brand: item.brand,
        description: `${seedTag} ${item.description}`,
        isActive: true,
      },
      update: {
        name: item.productName,
        brand: item.brand,
        description: `${seedTag} ${item.description}`,
        isActive: true,
      },
    });

    await prisma.variant.upsert({
      where: { sku: item.sku },
      create: {
        id: variantId,
        productId,
        sku: item.sku,
        barcode: item.barcode,
        name: item.variantName,
        retailPrice: new Prisma.Decimal(item.pricePence / 100),
        retailPricePence: item.pricePence,
        isActive: true,
      },
      update: {
        productId,
        barcode: item.barcode,
        name: item.variantName,
        retailPrice: new Prisma.Decimal(item.pricePence / 100),
        retailPricePence: item.pricePence,
        isActive: true,
      },
    });

    await prisma.barcode.upsert({
      where: { code: item.barcode },
      create: {
        variantId,
        code: item.barcode,
        type: 'EAN',
        isPrimary: true,
        packQty: 1,
      },
      update: {
        variantId,
        type: 'EAN',
        isPrimary: true,
        packQty: 1,
      },
    });

    await prisma.inventoryMovement.upsert({
      where: { id: stockMovementId },
      create: {
        id: stockMovementId,
        variantId,
        locationId,
        type: 'ADJUSTMENT',
        quantity: item.stockQty,
        referenceType: 'DEMO_SEED',
        referenceId: item.sku,
        note: `${seedTag} initial stock`,
        createdByStaffId,
      },
      update: {
        variantId,
        locationId,
        type: 'ADJUSTMENT',
        quantity: item.stockQty,
        referenceType: 'DEMO_SEED',
        referenceId: item.sku,
        note: `${seedTag} initial stock`,
        createdByStaffId,
      },
    });

    seededByKey[item.key] = {
      variantId,
      productId,
      pricePence: item.pricePence,
    };
  }

  return seededByKey;
};

const seedCustomers = async () => {
  const customerIds = [];

  for (const customer of DEMO_CUSTOMERS) {
    const fullName = `${customer.firstName} ${customer.lastName}`;
    const seeded = await prisma.customer.upsert({
      where: { email: customer.email },
      create: {
        id: customer.id,
        name: fullName,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        notes: customer.notes,
      },
      update: {
        name: fullName,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        notes: customer.notes,
      },
      select: { id: true },
    });
    customerIds.push(seeded.id);
  }

  return customerIds;
};

const seedWorkshopJobs = async (locationId, customerIds, productLookup) => {
  for (const [index, job] of DEMO_WORKSHOP_JOBS.entries()) {
    const customerId = customerIds[job.customerIndex] || null;
    const customer = customerId
      ? await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } })
      : null;

    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + job.scheduledOffsetDays);
    const manageToken = `demo-${mode}-job-${String(index + 1).padStart(2, '0')}`;

    const seededJob = await prisma.workshopJob.upsert({
      where: { id: job.id },
      create: {
        id: job.id,
        customerId,
        locationId,
        customerName: customer ? customer.name : null,
        bikeDescription: job.bikeDescription,
        status: job.status,
        source: 'IN_STORE',
        scheduledDate,
        manageToken,
        manageTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        notes: job.notes,
      },
      update: {
        customerId,
        locationId,
        customerName: customer ? customer.name : null,
        bikeDescription: job.bikeDescription,
        status: job.status,
        scheduledDate,
        notes: job.notes,
        manageToken,
        manageTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      },
      select: { id: true },
    });

    await prisma.workshopJobLine.deleteMany({
      where: { jobId: seededJob.id },
    });

    await prisma.workshopJobLine.createMany({
      data: job.lines.map((line) => {
        if (line.type === 'LABOUR') {
          return {
            jobId: seededJob.id,
            type: WorkshopJobLineType.LABOUR,
            description: line.description,
            qty: line.qty,
            unitPricePence: line.unitPricePence,
          };
        }

        const part = productLookup[line.productKey];
        if (!part) {
          throw new Error(`Unknown productKey in workshop seed: ${line.productKey}`);
        }
        return {
          jobId: seededJob.id,
          type: WorkshopJobLineType.PART,
          productId: part.productId,
          variantId: part.variantId,
          description: line.description,
          qty: line.qty,
          unitPricePence: line.unitPricePence || part.pricePence,
        };
      }),
    });
  }
};

const seedSales = async (locationId, customerIds, productLookup, createdByStaffId) => {
  for (const [index, seed] of DEMO_SALES.entries()) {
    const items = seed.items.map((entry) => {
      const product = productLookup[entry.productKey];
      if (!product) {
        throw new Error(`Unknown productKey in sale seed: ${entry.productKey}`);
      }
      return {
        variantId: product.variantId,
        quantity: entry.qty,
        unitPricePence: product.pricePence,
        lineTotalPence: product.pricePence * entry.qty,
      };
    });

    const subtotalPence = items.reduce((sum, item) => sum + item.lineTotalPence, 0);
    const completedAt = seed.completed ? new Date(Date.now() - index * 1000 * 60 * 60) : null;

    await prisma.sale.upsert({
      where: { id: seed.id },
      create: {
        id: seed.id,
        customerId: customerIds[seed.customerIndex] || null,
        locationId,
        subtotalPence,
        taxPence: 0,
        totalPence: subtotalPence,
        createdByStaffId,
        completedAt,
      },
      update: {
        customerId: customerIds[seed.customerIndex] || null,
        locationId,
        subtotalPence,
        taxPence: 0,
        totalPence: subtotalPence,
        createdByStaffId,
        completedAt,
        changeDuePence: 0,
      },
    });

    await prisma.saleItem.deleteMany({ where: { saleId: seed.id } });
    await prisma.saleTender.deleteMany({ where: { saleId: seed.id } });

    await prisma.saleItem.createMany({
      data: items.map((item) => ({
        saleId: seed.id,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPricePence: item.unitPricePence,
        lineTotalPence: item.lineTotalPence,
      })),
    });

    if (seed.completed) {
      await prisma.saleTender.create({
        data: {
          saleId: seed.id,
          method: seed.tenderMethod,
          amountPence: subtotalPence,
          createdByStaffId,
        },
      });

      await issueReceipt({
        saleId: seed.id,
        issuedByStaffId: createdByStaffId,
      });
    } else {
      await prisma.receipt.deleteMany({ where: { saleId: seed.id } });
      await prisma.sale.update({ where: { id: seed.id }, data: { receiptNumber: null } });
    }
  }
};

const printSummary = () => {
  console.log('');
  console.log('Demo users created:');
  console.log('admin / admin123');
  console.log('manager / manager123');
  console.log('staff / staff123');
  console.log('');
  console.log(`Seed mode: ${mode}`);
  console.log(`Products: ${DEMO_PRODUCTS.length}`);
  console.log(`Customers: ${DEMO_CUSTOMERS.length}`);
  console.log(`Workshop jobs: ${DEMO_WORKSHOP_JOBS.length}`);
  console.log(`Sales: ${DEMO_SALES.length}`);
};

const run = async () => {
  requireDatabaseUrl();
  const location = await ensureDefaultLocation();

  const users = await seedUsers();
  const manager = users.manager || users.admin;
  if (!manager) {
    throw new Error('Expected a manager or admin user to exist after seeding.');
  }

  const products = await seedProducts(location.id, manager.id);
  const customers = await seedCustomers();
  await seedWorkshopJobs(location.id, customers, products);
  await seedSales(location.id, customers, products, manager.id);
  printSummary();
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
