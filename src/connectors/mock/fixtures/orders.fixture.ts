export interface MockOrderStatus {
  orderId: string;
  organizationId: string;
  customerCode: string;
  status: 'confirmed' | 'picking' | 'shipped' | 'delayed';
  requestedShipDate: string;
  committedShipDate: string;
  lineCount: number;
  holdReason?: string;
}

export const mockOrderStatuses: MockOrderStatus[] = [
  {
    orderId: 'SO-10001',
    organizationId: 'org-demo',
    customerCode: 'CUST-DEMO-01',
    status: 'picking',
    requestedShipDate: '2026-06-18',
    committedShipDate: '2026-06-18',
    lineCount: 4
  },
  {
    orderId: 'SO-10002',
    organizationId: 'org-demo',
    customerCode: 'CUST-DEMO-02',
    status: 'delayed',
    requestedShipDate: '2026-06-17',
    committedShipDate: '2026-06-20',
    lineCount: 2,
    holdReason: 'Awaiting replenishment for demo item SKU-DEMO-RED'
  }
];
