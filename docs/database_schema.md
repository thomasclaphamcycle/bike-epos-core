# Database Schema Reference

This document summarizes key Prisma models used by CorePOS.

## Naming notes
The product requirements often refer to:

- `Staff` -> implemented as Prisma model `User`
- `SaleLine` -> implemented as `SaleItem`
- `WorkshopLine` -> implemented as `WorkshopJobLine`

## `User` (Staff)
Purpose: application staff identity, authentication, and role-based authorization.

Key fields:

- `id` (cuid, primary key)
- `username` (unique)
- `email` (unique, nullable)
- `passwordHash`
- `role` (`STAFF | MANAGER | ADMIN`)
- `isActive`
- `createdAt`, `updatedAt`

Key relations:

- created sales, tenders, refunds, receipts
- workshop assignments/notes
- cash/till records, purchasing records

## `Product`
Purpose: catalog-level product definition; variants hold sellable SKUs.

Key fields:

- `id` (cuid)
- `name`
- `brand` (nullable)
- `description` (nullable)
- `isActive`
- `createdAt`, `updatedAt`

Key relations:

- `variants` (`Variant[]`)
- workshop lines and stock reservations

## `Sale`
Purpose: finalized or in-progress checkout transaction.

Key fields:

- `id` (uuid)
- `basketId` (nullable, unique)
- `workshopJobId` (nullable, unique)
- `customerId` (nullable)
- `subtotalPence`, `taxPence`, `totalPence`, `changeDuePence`
- `createdAt`, `completedAt`
- `receiptNumber` (nullable, unique)
- `createdByStaffId` (nullable)

Key relations:

- `items` (`SaleItem[]`)
- `tenders` (`SaleTender[]`)
- `payments` (`Payment[]`)
- `receipt` (`Receipt?`)
- `refunds` (`Refund[]`)

## `SaleItem` (SaleLine)
Purpose: immutable line items attached to a sale.

Key fields:

- `id` (uuid)
- `saleId`
- `variantId`
- `quantity`
- `unitPricePence`
- `lineTotalPence`

Key relations:

- belongs to `Sale`
- links to `Variant`
- referenced by returns/refund line records

## `Payment`
Purpose: payment records linked to sale or workshop charge contexts.

Key fields:

- `id` (uuid)
- `saleId` (nullable)
- `workshopJobId` (nullable)
- `method` (`CASH | CARD | OTHER`)
- `purpose` (`DEPOSIT | FINAL | ADJUSTMENT | CREDIT_APPLIED | CREDIT_ISSUED`)
- `status` (`COMPLETED | PARTIALLY_REFUNDED | REFUNDED`)
- `amountPence`
- `refundedTotalPence`
- `providerRef` (nullable)
- `createdAt`

Key relations:

- belongs to `Sale` or `WorkshopJob`
- has many `PaymentRefund`

## `WorkshopJob`
Purpose: job card for service/repair workflow.

Key fields:

- `id` (uuid)
- `customerId` (nullable)
- `customerName`, `bikeDescription` (nullable)
- `assignedStaffId`, `assignedStaffName` (nullable)
- `status` (`WorkshopJobStatus` enum)
- `scheduledDate` (nullable)
- `depositRequiredPence`, `depositStatus`
- `manageToken`, `manageTokenExpiresAt` (nullable)
- `cancelledAt`, `completedAt`, `closedAt` (nullable)
- `finalizedBasketId` (nullable)
- `notes` (nullable)
- `createdAt`, `updatedAt`

Key relations:

- optional linked `sale`
- `lines` (`WorkshopJobLine[]`)
- `parts` (`WorkshopJobPart[]`)
- `stockReservations` (`StockReservation[]`)
- `payments`, `jobNotes`, cancellations

## `WorkshopJobLine` (WorkshopLine)
Purpose: structured labour/part estimate lines on a workshop job.

Key fields:

- `id` (uuid)
- `jobId`
- `type` (`PART | LABOUR`)
- `productId` (nullable)
- `variantId` (nullable)
- `description`
- `qty`
- `unitPricePence`
- `createdAt`, `updatedAt`

Key relations:

- belongs to `WorkshopJob`
- optional link to `Product`/`Variant`

## `InventoryMovement`
Purpose: append-only inventory ledger event.

Key fields:

- `id` (cuid)
- `variantId`
- `type` (`PURCHASE_RECEIPT | PURCHASE | SALE | ADJUSTMENT | WORKSHOP_USE | RETURN`)
- `quantity` (signed integer delta)
- `unitCost` (decimal, nullable)
- `referenceType`, `referenceId` (nullable)
- `note` (nullable)
- `createdByStaffId` (nullable)
- `createdAt`

Key relations:

- belongs to `Variant`

## `AuditLog`
Purpose: internal audit trail for key business actions.

Key fields:

- `id` (cuid)
- `createdAt`
- `staffId` (nullable)
- `action`
- `entity`
- `entityId` (nullable)
- `details` (json, nullable)

Indexes:

- `[entity, entityId]`
- `[staffId]`
- `[createdAt]`

