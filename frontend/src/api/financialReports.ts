import { apiGet } from "./client";

export type FinancialFilters = {
  from: string;
  to: string;
  preset: "current_month_to_date" | "custom";
  timezone: string;
  label: string;
};

export type FinancialCostBasis = {
  revenueWithKnownCostPence: number;
  revenueWithoutCostBasisPence: number;
  knownCostCoveragePercent: number;
  workshopServiceRevenuePence: number;
  workshopPartsWithoutCostBasisPence: number;
  retailRevenueWithoutCostBasisPence: number;
  notes: string[];
};

export type FinancialMonthlyMarginReport = {
  filters: FinancialFilters;
  summary: {
    grossSalesPence: number;
    refundsPence: number;
    revenuePence: number;
    cogsPence: number;
    grossMarginPence: number;
    grossMarginPercent: number;
    transactions: number;
    refundCount: number;
    averageSaleValuePence: number;
  };
  costBasis: FinancialCostBasis;
};

export type FinancialMonthlySalesSummaryReport = {
  filters: FinancialFilters;
  summary: {
    grossSalesPence: number;
    refundsPence: number;
    revenuePence: number;
    transactions: number;
    refundCount: number;
    averageSaleValuePence: number;
  };
};

export type FinancialSalesByCategoryRow = {
  categoryName: string;
  grossSalesPence: number;
  refundsPence: number;
  revenuePence: number;
  cogsPence: number;
  grossMarginPence: number;
  grossMarginPercent: number;
  quantitySold: number;
  quantityRefunded: number;
  netQuantity: number;
  revenueWithKnownCostPence: number;
  revenueWithoutCostBasisPence: number;
  knownCostCoveragePercent: number;
};

export type FinancialSalesByCategoryReport = {
  filters: FinancialFilters;
  summary: {
    categoryCount: number;
    grossSalesPence: number;
    refundsPence: number;
    revenuePence: number;
    quantitySold: number;
    quantityRefunded: number;
    netQuantity: number;
    revenueWithKnownCostPence: number;
    revenueWithoutCostBasisPence: number;
    knownCostCoveragePercent: number;
    topCategoryName: string | null;
    topCategoryRevenuePence: number;
  };
  categories: FinancialSalesByCategoryRow[];
  costBasis: {
    notes: string[];
  };
};

export const getFinancialMonthlyMarginReport = () =>
  apiGet<FinancialMonthlyMarginReport>("/api/reports/financial/monthly-margin");

export const getFinancialMonthlySalesSummaryReport = () =>
  apiGet<FinancialMonthlySalesSummaryReport>("/api/reports/financial/monthly-sales");

export const getFinancialSalesByCategoryReport = () =>
  apiGet<FinancialSalesByCategoryReport>("/api/reports/financial/sales-by-category");
