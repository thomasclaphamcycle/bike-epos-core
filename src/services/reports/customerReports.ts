import { prisma } from "../../lib/prisma";
import { HttpError } from "../../utils/http";
import {
  OPEN_WORKSHOP_STATUSES,
  REMINDER_OPEN_STATUSES,
  addDaysUtc,
  getDateRangeWithTakeOrThrow,
  parseDateOnlyOrThrow,
  toCustomerDisplayName,
  toPositiveIntWithinRangeOrThrow,
} from "./shared";

type CustomerReminderQueueStatus = "DUE_SOON" | "OVERDUE" | "RECENT_ACTIVITY";

export const getCustomerInsightsReport = async (from?: string, to?: string, take?: number) => {
  const range = getDateRangeWithTakeOrThrow(from, to, take);
  const fromDate = parseDateOnlyOrThrow(range.from, "from");
  const toDate = new Date(`${range.to}T23:59:59.999Z`);

  const [customers, sales, workshopJobs, creditAccounts] = await Promise.all([
    prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
      },
    }),
    prisma.sale.findMany({
      where: {
        customerId: { not: null },
        completedAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      select: {
        id: true,
        customerId: true,
        totalPence: true,
        completedAt: true,
      },
    }),
    prisma.workshopJob.findMany({
      where: {
        customerId: { not: null },
      },
      select: {
        id: true,
        customerId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
    }),
    prisma.creditAccount.findMany({
      where: {
        customerId: { not: null },
      },
      select: {
        customerId: true,
        entries: {
          select: {
            amountPence: true,
          },
        },
      },
    }),
  ]);

  const salesByCustomer = new Map<string, {
    saleCount: number;
    totalSpendPence: number;
    lastSaleAt: Date | null;
  }>();
  for (const sale of sales) {
    if (!sale.customerId) {
      continue;
    }
    const current = salesByCustomer.get(sale.customerId) ?? {
      saleCount: 0,
      totalSpendPence: 0,
      lastSaleAt: null,
    };
    current.saleCount += 1;
    current.totalSpendPence += sale.totalPence;
    if (sale.completedAt && (!current.lastSaleAt || sale.completedAt > current.lastSaleAt)) {
      current.lastSaleAt = sale.completedAt;
    }
    salesByCustomer.set(sale.customerId, current);
  }

  const workshopByCustomer = new Map<string, {
    totalWorkshopJobs: number;
    activeWorkshopJobs: number;
    recentWorkshopJobs: number;
    lastWorkshopAt: Date | null;
  }>();
  for (const job of workshopJobs) {
    if (!job.customerId) {
      continue;
    }
    const current = workshopByCustomer.get(job.customerId) ?? {
      totalWorkshopJobs: 0,
      activeWorkshopJobs: 0,
      recentWorkshopJobs: 0,
      lastWorkshopAt: null,
    };
    current.totalWorkshopJobs += 1;
    if (OPEN_WORKSHOP_STATUSES.has(job.status)) {
      current.activeWorkshopJobs += 1;
    }
    if (job.updatedAt >= fromDate && job.updatedAt <= toDate) {
      current.recentWorkshopJobs += 1;
    }
    if (!current.lastWorkshopAt || job.updatedAt > current.lastWorkshopAt) {
      current.lastWorkshopAt = job.updatedAt;
    }
    workshopByCustomer.set(job.customerId, current);
  }

  const creditByCustomer = new Map<string, number>();
  for (const account of creditAccounts) {
    if (!account.customerId) {
      continue;
    }
    const balance = account.entries.reduce((sum, entry) => sum + entry.amountPence, 0);
    creditByCustomer.set(account.customerId, balance);
  }

  const baseRows = customers.map((customer) => {
    const salesRow = salesByCustomer.get(customer.id);
    const workshopRow = workshopByCustomer.get(customer.id);
    const creditBalancePence = creditByCustomer.get(customer.id) ?? 0;
    const lastActivityAtCandidates = [salesRow?.lastSaleAt, workshopRow?.lastWorkshopAt].filter(
      (value): value is Date => Boolean(value),
    );
    const lastActivityAt = lastActivityAtCandidates.length > 0
      ? [...lastActivityAtCandidates].sort((left, right) => right.getTime() - left.getTime())[0]
      : null;

    return {
      customerId: customer.id,
      customerName: toCustomerDisplayName(customer),
      email: customer.email,
      phone: customer.phone,
      saleCount: salesRow?.saleCount ?? 0,
      totalSpendPence: salesRow?.totalSpendPence ?? 0,
      averageOrderValuePence:
        salesRow && salesRow.saleCount > 0 ? Math.round(salesRow.totalSpendPence / salesRow.saleCount) : 0,
      totalWorkshopJobs: workshopRow?.totalWorkshopJobs ?? 0,
      activeWorkshopJobs: workshopRow?.activeWorkshopJobs ?? 0,
      recentWorkshopJobs: workshopRow?.recentWorkshopJobs ?? 0,
      creditBalancePence,
      lastSaleAt: salesRow?.lastSaleAt ?? null,
      lastWorkshopAt: workshopRow?.lastWorkshopAt ?? null,
      lastActivityAt,
      createdAt: customer.createdAt,
    };
  });

  const customersWithSales = baseRows.filter((row) => row.saleCount > 0);
  const averageSpendPence = customersWithSales.length > 0
    ? Math.round(customersWithSales.reduce((sum, row) => sum + row.totalSpendPence, 0) / customersWithSales.length)
    : 0;

  const customersWithFlags = baseRows.map((row) => ({
    ...row,
    isRepeatCustomer: row.saleCount >= 2,
    isHighValueCustomer: row.totalSpendPence > 0 && row.totalSpendPence >= averageSpendPence,
  }));

  const topCustomers = [...customersWithFlags]
    .filter((row) => row.totalSpendPence > 0)
    .sort((left, right) => (
      right.totalSpendPence - left.totalSpendPence
      || right.saleCount - left.saleCount
      || left.customerName.localeCompare(right.customerName)
    ))
    .slice(0, range.take);

  const repeatCustomers = [...customersWithFlags]
    .filter((row) => row.isRepeatCustomer)
    .sort((left, right) => (
      right.saleCount - left.saleCount
      || right.totalSpendPence - left.totalSpendPence
      || left.customerName.localeCompare(right.customerName)
    ))
    .slice(0, range.take);

  const recentActivityCustomers = [...customersWithFlags]
    .filter((row) => row.lastActivityAt)
    .sort((left, right) => (
      (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0)
      || left.customerName.localeCompare(right.customerName)
    ))
    .slice(0, range.take);

  const workshopActiveCustomers = [...customersWithFlags]
    .filter((row) => row.activeWorkshopJobs > 0)
    .sort((left, right) => (
      right.activeWorkshopJobs - left.activeWorkshopJobs
      || (right.lastWorkshopAt?.getTime() ?? 0) - (left.lastWorkshopAt?.getTime() ?? 0)
      || left.customerName.localeCompare(right.customerName)
    ))
    .slice(0, range.take);

  return {
    filters: range,
    summary: {
      customerCount: baseRows.length,
      activeCustomerCount: customersWithFlags.filter((row) => row.saleCount > 0 || row.activeWorkshopJobs > 0).length,
      repeatCustomerCount: customersWithFlags.filter((row) => row.isRepeatCustomer).length,
      highValueCustomerCount: customersWithFlags.filter((row) => row.isHighValueCustomer).length,
      workshopActiveCustomerCount: customersWithFlags.filter((row) => row.activeWorkshopJobs > 0).length,
      customersWithCreditCount: customersWithFlags.filter((row) => row.creditBalancePence !== 0).length,
      totalCreditBalancePence: customersWithFlags.reduce((sum, row) => sum + row.creditBalancePence, 0),
      averageSpendPence,
    },
    topCustomers,
    repeatCustomers,
    recentActivityCustomers,
    workshopActiveCustomers,
    customers: customersWithFlags,
    creditSupported: true,
  };
};

export const getCustomerServiceRemindersReport = async (
  dueSoonDays?: number,
  overdueDays?: number,
  lookbackDays?: number,
  take?: number,
) => {
  const resolvedDueSoonDays = toPositiveIntWithinRangeOrThrow(dueSoonDays, "dueSoonDays", 1, 3650, 90);
  const resolvedOverdueDays = toPositiveIntWithinRangeOrThrow(overdueDays, "overdueDays", 1, 3650, 180);
  const resolvedLookbackDays = toPositiveIntWithinRangeOrThrow(lookbackDays, "lookbackDays", 30, 3650, 365);
  const resolvedTake = toPositiveIntWithinRangeOrThrow(take, "take", 1, 200, 100);

  if (resolvedOverdueDays < resolvedDueSoonDays) {
    throw new HttpError(400, "overdueDays must be greater than or equal to dueSoonDays", "INVALID_REPORT_FILTER");
  }
  if (resolvedLookbackDays < resolvedOverdueDays) {
    throw new HttpError(400, "lookbackDays must be greater than or equal to overdueDays", "INVALID_REPORT_FILTER");
  }

  const now = new Date();
  const lookbackStart = addDaysUtc(now, -resolvedLookbackDays);

  const [completedWorkshopJobs, recentSales, openWorkshopJobs] = await Promise.all([
    prisma.workshopJob.findMany({
      where: {
        customerId: { not: null },
        completedAt: { not: null, gte: lookbackStart },
      },
      select: {
        id: true,
        customerId: true,
        customer: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        bikeDescription: true,
        completedAt: true,
      },
      orderBy: [{ completedAt: "desc" }],
    }),
    prisma.sale.findMany({
      where: {
        customerId: { not: null },
        completedAt: { not: null, gte: lookbackStart },
      },
      select: {
        customerId: true,
        completedAt: true,
      },
      orderBy: [{ completedAt: "desc" }],
    }),
    prisma.workshopJob.findMany({
      where: {
        customerId: { not: null },
        status: {
          in: REMINDER_OPEN_STATUSES,
        },
      },
      select: {
        customerId: true,
      },
    }),
  ]);

  const latestSaleByCustomer = new Map<string, Date>();
  for (const sale of recentSales) {
    if (!sale.customerId || !sale.completedAt || latestSaleByCustomer.has(sale.customerId)) {
      continue;
    }
    latestSaleByCustomer.set(sale.customerId, sale.completedAt);
  }

  const openJobsByCustomer = new Map<string, number>();
  for (const job of openWorkshopJobs) {
    if (!job.customerId) {
      continue;
    }
    openJobsByCustomer.set(job.customerId, (openJobsByCustomer.get(job.customerId) ?? 0) + 1);
  }

  const remindersByCustomer = new Map<string, {
    customerId: string;
    customerName: string;
    email: string | null;
    phone: string | null;
    lastCompletedWorkshopAt: Date;
    latestWorkshopJobId: string;
    latestBikeDescription: string | null;
    completedWorkshopJobsInWindow: number;
    activeWorkshopJobs: number;
    lastSaleAt: Date | null;
  }>();

  for (const job of completedWorkshopJobs) {
    if (!job.customerId || !job.customer || !job.completedAt) {
      continue;
    }

    const existing = remindersByCustomer.get(job.customerId);
    if (!existing) {
      remindersByCustomer.set(job.customerId, {
        customerId: job.customerId,
        customerName: toCustomerDisplayName(job.customer),
        email: job.customer.email,
        phone: job.customer.phone,
        lastCompletedWorkshopAt: job.completedAt,
        latestWorkshopJobId: job.id,
        latestBikeDescription: job.bikeDescription,
        completedWorkshopJobsInWindow: 1,
        activeWorkshopJobs: openJobsByCustomer.get(job.customerId) ?? 0,
        lastSaleAt: latestSaleByCustomer.get(job.customerId) ?? null,
      });
      continue;
    }

    existing.completedWorkshopJobsInWindow += 1;
  }

  const customers = Array.from(remindersByCustomer.values())
    .map((row) => {
      const daysSinceLastCompletedWorkshop = Math.max(
        0,
        Math.floor((now.getTime() - row.lastCompletedWorkshopAt.getTime()) / 86_400_000),
      );

      let reminderStatus: "RECENT_COMPLETION" | "DUE_SOON" | "OVERDUE" = "RECENT_COMPLETION";
      if (daysSinceLastCompletedWorkshop >= resolvedOverdueDays) {
        reminderStatus = "OVERDUE";
      } else if (daysSinceLastCompletedWorkshop >= resolvedDueSoonDays) {
        reminderStatus = "DUE_SOON";
      }

      return {
        ...row,
        daysSinceLastCompletedWorkshop,
        reminderStatus,
      };
    })
    .sort((left, right) => {
      const statusRank = { OVERDUE: 3, DUE_SOON: 2, RECENT_COMPLETION: 1 } as const;
      return (
        statusRank[right.reminderStatus] - statusRank[left.reminderStatus]
        || right.daysSinceLastCompletedWorkshop - left.daysSinceLastCompletedWorkshop
        || left.customerName.localeCompare(right.customerName)
      );
    });

  const items = customers
    .map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      email: row.email,
      phone: row.phone,
      contact: row.phone?.trim() || row.email?.trim() || null,
      lastWorkshopJobDate: row.lastCompletedWorkshopAt,
      daysSinceLastWorkshopJob: row.daysSinceLastCompletedWorkshop,
      reminderStatus: (row.reminderStatus === "RECENT_COMPLETION"
        ? "RECENT_ACTIVITY"
        : row.reminderStatus) as CustomerReminderQueueStatus,
      latestWorkshopJobId: row.latestWorkshopJobId,
    }))
    .slice(0, resolvedTake);

  return {
    filters: {
      dueSoonDays: resolvedDueSoonDays,
      overdueDays: resolvedOverdueDays,
      lookbackDays: resolvedLookbackDays,
      take: resolvedTake,
    },
    summary: {
      customerCount: customers.length,
      overdueCount: customers.filter((row) => row.reminderStatus === "OVERDUE").length,
      dueSoonCount: customers.filter((row) => row.reminderStatus === "DUE_SOON").length,
      recentCompletionCount: customers.filter((row) => row.reminderStatus === "RECENT_COMPLETION").length,
      recentActivityCount: items.filter((row) => row.reminderStatus === "RECENT_ACTIVITY").length,
    },
    overdueCustomers: customers.filter((row) => row.reminderStatus === "OVERDUE").slice(0, resolvedTake),
    dueSoonCustomers: customers.filter((row) => row.reminderStatus === "DUE_SOON").slice(0, resolvedTake),
    recentCompletedCustomers: customers.filter((row) => row.reminderStatus === "RECENT_COMPLETION").slice(0, resolvedTake),
    recentActivityCustomers: items.filter((row) => row.reminderStatus === "RECENT_ACTIVITY"),
    customers: customers.slice(0, resolvedTake),
    items,
  };
};
