import { prisma } from "../../lib/prisma";
import { OPEN_WORKSHOP_STATUSES, addDaysUtc } from "./shared";
import { getCustomerServiceRemindersReport } from "./customerReports";
import { getInventoryVelocity } from "./inventoryReports";
import { getPricingExceptionsReport } from "./pricingReports";
import { getWorkshopCapacityReport } from "./workshopReports";

type OperationsExceptionSeverity = "CRITICAL" | "WARNING" | "INFO";

export const getOperationsExceptions = async () => {
  const now = new Date();
  const workshopAgeThresholdDays = 14;
  const [pricing, velocity, workshopCapacity, reminders, overduePurchaseOrders, oldWorkshopJobs] = await Promise.all([
    getPricingExceptionsReport(),
    getInventoryVelocity(),
    getWorkshopCapacityReport(),
    getCustomerServiceRemindersReport(30, 60, 365, 100),
    prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: ["SENT", "PARTIALLY_RECEIVED"],
        },
        expectedAt: {
          lt: now,
        },
      },
      select: {
        id: true,
        poNumber: true,
        expectedAt: true,
        supplier: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ expectedAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.workshopJob.findMany({
      where: {
        status: {
          in: Array.from(OPEN_WORKSHOP_STATUSES),
        },
        createdAt: {
          lt: addDaysUtc(now, -workshopAgeThresholdDays),
        },
      },
      select: {
        id: true,
        customerName: true,
        bikeDescription: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);

  const items = [
    ...pricing.items.map((row) => ({
      type: row.exceptionType,
      entityId: row.variantId,
      title: `${row.productName} pricing exception`,
      description:
        row.exceptionType === "MISSING_RETAIL_PRICE"
          ? `SKU ${row.sku} has no usable retail price.`
          : row.exceptionType === "RETAIL_AT_OR_BELOW_COST"
            ? `SKU ${row.sku} is priced at or below cost.`
            : `SKU ${row.sku} is below the 20% apparent margin threshold.`,
      severity: (row.exceptionType === "LOW_MARGIN" ? "WARNING" : "CRITICAL") as OperationsExceptionSeverity,
      link: `/inventory/${row.variantId}`,
    })),
    ...velocity.items
      .filter((row) => row.velocityClass === "DEAD_STOCK")
      .map((row) => ({
        type: "DEAD_STOCK",
        entityId: row.variantId,
        title: `${row.productName} dead stock`,
        description: `${row.onHand} on hand with no sales in the last 90 days.`,
        severity: "INFO" as OperationsExceptionSeverity,
        link: `/inventory/${row.variantId}`,
      })),
    ...overduePurchaseOrders.map((row) => {
      const overdueDays = row.expectedAt
        ? Math.max(0, Math.floor((now.getTime() - row.expectedAt.getTime()) / 86_400_000))
        : null;
      return {
        type: "OVERDUE_PURCHASE_ORDER",
        entityId: row.id,
        title: `Purchase order ${row.poNumber} is overdue`,
        description: `${row.supplier.name}${overdueDays !== null ? ` | ${overdueDays} days overdue` : ""}`,
        severity: "WARNING" as OperationsExceptionSeverity,
        link: `/purchasing/${row.id}`,
      };
    }),
    ...(workshopCapacity.estimatedBacklogDays !== null && workshopCapacity.estimatedBacklogDays > 5
      ? [{
          type: "WORKSHOP_BACKLOG",
          entityId: "workshop-backlog",
          title: "Workshop backlog pressure",
          description: `${workshopCapacity.openJobCount} open jobs with ${workshopCapacity.estimatedBacklogDays.toFixed(1)} estimated backlog days.`,
          severity: "WARNING" as OperationsExceptionSeverity,
          link: "/management/capacity",
        }]
      : []),
    ...oldWorkshopJobs.map((row) => {
      const ageDays = Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / 86_400_000));
      return {
        type: "WORKSHOP_OLD_JOB",
        entityId: row.id,
        title: row.customerName?.trim() || row.bikeDescription?.trim() || `Workshop job ${row.id.slice(0, 8)}`,
        description: `${ageDays} days open in the workshop queue.`,
        severity: "CRITICAL" as OperationsExceptionSeverity,
        link: `/workshop/${row.id}`,
      };
    }),
    ...reminders.items
      .filter((row) => row.reminderStatus === "OVERDUE")
      .map((row) => ({
        type: "CUSTOMER_OVERDUE_REMINDER",
        entityId: row.customerId,
        title: `${row.customerName} service follow-up`,
        description: `${row.daysSinceLastWorkshopJob} days since the last completed workshop job.`,
        severity: "INFO" as OperationsExceptionSeverity,
        link: `/customers/${row.customerId}`,
      })),
  ].sort((left, right) => (
    (right.severity === "CRITICAL" ? 3 : right.severity === "WARNING" ? 2 : 1)
    - (left.severity === "CRITICAL" ? 3 : left.severity === "WARNING" ? 2 : 1)
    || left.title.localeCompare(right.title)
  ));

  return {
    generatedAt: now.toISOString(),
    summary: {
      total: items.length,
      critical: items.filter((row) => row.severity === "CRITICAL").length,
      warning: items.filter((row) => row.severity === "WARNING").length,
      info: items.filter((row) => row.severity === "INFO").length,
    },
    items,
  };
};
