export const syntheticDashboardFacts = {
  ReportId: 'synthetic-report-1', NewOrders: { Current: 8, Previous: 5 },
  LateOrders: { Current: 2, Previous: 3 }, CompletionRate: 87.25, Period: 'today',
  Categories: [{ Name: 'A', Count: 4 }, { Name: 'B', Count: 6 }], OptionalNote: null,
  CustomerSatisfaction: 4.5
};

export const syntheticDashboardUpstreamResponse = {
  Code: 200, ...syntheticDashboardFacts,
  Categories: syntheticDashboardFacts.Categories.map((row) => ({ ...row, InternalToken: 'synthetic-row-secret' })),
  InternalToken: 'synthetic-secret'
};
