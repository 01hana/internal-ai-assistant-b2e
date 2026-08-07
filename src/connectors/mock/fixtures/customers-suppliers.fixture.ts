export interface MockBusinessPartnerHistory {
  partnerId: string;
  organizationId: string;
  partnerType: 'customer' | 'supplier';
  displayCode: string;
  relationshipStatus: 'active' | 'watchlist' | 'inactive';
  recentActivitySummary: string;
  openItemCount: number;
  riskNotes: string[];
}

export const mockBusinessPartnerHistory: MockBusinessPartnerHistory[] = [
  {
    partnerId: 'BP-CUSTOMER-001',
    organizationId: 'org-demo',
    partnerType: 'customer',
    displayCode: 'CUST-DEMO-01',
    relationshipStatus: 'active',
    recentActivitySummary: 'Placed two demo orders in the last 30 days with no overdue invoices.',
    openItemCount: 2,
    riskNotes: []
  },
  {
    partnerId: 'BP-SUPPLIER-001',
    organizationId: 'org-demo',
    partnerType: 'supplier',
    displayCode: 'SUP-DEMO-01',
    relationshipStatus: 'watchlist',
    recentActivitySummary: 'Delivered the last demo purchase order three days later than promised.',
    openItemCount: 1,
    riskNotes: ['Monitor lead time variance before confirming urgent production plans.']
  }
];
