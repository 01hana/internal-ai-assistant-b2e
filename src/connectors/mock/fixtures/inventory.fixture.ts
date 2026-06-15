export interface MockInventoryAvailability {
  itemSku: string;
  organizationId: string;
  warehouseCode: string;
  availableQuantity: number;
  allocatedQuantity: number;
  incomingQuantity: number;
  nextReceiptDate?: string;
}

export const mockInventoryAvailability: MockInventoryAvailability[] = [
  {
    itemSku: 'SKU-DEMO-RED',
    organizationId: 'org-demo',
    warehouseCode: 'WH-DEMO-TPE',
    availableQuantity: 36,
    allocatedQuantity: 48,
    incomingQuantity: 120,
    nextReceiptDate: '2026-06-18'
  },
  {
    itemSku: 'SKU-DEMO-BLUE',
    organizationId: 'org-demo',
    warehouseCode: 'WH-DEMO-TPE',
    availableQuantity: 14,
    allocatedQuantity: 16,
    incomingQuantity: 40,
    nextReceiptDate: '2026-06-19'
  }
];
