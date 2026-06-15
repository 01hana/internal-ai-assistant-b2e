export interface MockWorkOrderProgress {
  workOrderId: string;
  organizationId: string;
  itemSku: string;
  status: 'released' | 'in_progress' | 'paused' | 'completed';
  plannedQuantity: number;
  completedQuantity: number;
  currentOperation: string;
  estimatedCompletionAt: string;
}

export const mockWorkOrderProgress: MockWorkOrderProgress[] = [
  {
    workOrderId: 'WO-20001',
    organizationId: 'org-demo',
    itemSku: 'SKU-DEMO-RED',
    status: 'in_progress',
    plannedQuantity: 120,
    completedQuantity: 72,
    currentOperation: 'assembly',
    estimatedCompletionAt: '2026-06-16T10:30:00.000Z'
  },
  {
    workOrderId: 'WO-20002',
    organizationId: 'org-demo',
    itemSku: 'SKU-DEMO-BLUE',
    status: 'paused',
    plannedQuantity: 80,
    completedQuantity: 24,
    currentOperation: 'quality_check',
    estimatedCompletionAt: '2026-06-17T08:00:00.000Z'
  }
];
