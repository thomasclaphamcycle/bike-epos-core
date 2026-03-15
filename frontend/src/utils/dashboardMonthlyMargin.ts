export type DashboardMonthlyMarginSnapshot = {
  revenueGbp: number;
  costGbp: number;
  marginGbp: number;
  marginPercent: number;
};

export const getTemporaryDashboardMonthlyMargin = (): DashboardMonthlyMarginSnapshot => {
  // TODO: Replace this temporary mock with real cost-aware monthly margin reporting data.
  return {
    revenueGbp: 42380,
    costGbp: 28150,
    marginGbp: 14230,
    marginPercent: 33.6,
  };
};
