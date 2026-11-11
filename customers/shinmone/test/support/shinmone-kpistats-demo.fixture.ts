/** Isolated, Human-supplied Demo contract. Never load these operations in production registration. */
export const demoPeriods = [
  { canonical: 'today', wire: 'today', suffix: 'today' },
  { canonical: 'this_week', wire: 'thisWeek', suffix: 'weekly' },
  { canonical: 'this_month', wire: 'thisMonth', suffix: 'monthly' }
] as const;

export const demoMetricNames = [
  'NewOrders', 'CompletedOrders', 'InProductionOrders',
  'AvgCompletionRate', 'OverdueOrders', 'TodayShipments'
] as const;

const labels: Record<(typeof demoMetricNames)[number], string> = {
  NewOrders: '新增工單統計', CompletedOrders: '完工工單統計',
  InProductionOrders: '生產中工單統計', AvgCompletionRate: '完工率',
  OverdueOrders: '逾期工單統計', TodayShipments: '出貨工單統計'
};

const closed = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const wireNumber = { type: 'number' };
const wireString = { type: 'string', maxLength: 128 };
const wireMetric = closed({ Current: wireNumber, Previous: wireNumber, Change: wireNumber,
  Trend: wireString, ChangePercentage: wireNumber });
const wireData = closed({ ...Object.fromEntries(demoMetricNames.map((name) => [name, wireMetric])),
  LastUpdated: wireString, TimeRange: wireString });

const outputMetric = (name: (typeof demoMetricNames)[number]) => {
  const unit = name === 'AvgCompletionRate' ? '%' : '張';
  return {
    type: 'object', additionalProperties: false,
    description: labels[name], required: ['Current', 'Previous', 'Change', 'Trend', 'ChangePercentage'],
    properties: {
      Current: { type: 'number', description: '本期', 'x-unit': unit },
      Previous: { type: 'number', description: '前期', 'x-unit': unit },
      Change: { type: 'number', description: '本期減前期',
        'x-unit': name === 'AvgCompletionRate' ? '百分點' : '張' },
      Trend: { type: 'string', enum: ['up', 'down', 'neutral'] },
      ChangePercentage: { type: 'number', description: '相對變化', 'x-unit': '%' }
    }
  };
};

export const demoApprovedDataSchema = closed({
  ...Object.fromEntries(demoMetricNames.map((name) => [name, outputMetric(name)])),
  LastUpdated: { type: 'string', description: '最後更新時間' },
  TimeRange: { type: 'string', enum: ['today', 'thisWeek', 'thisMonth'], description: '本次統計期間' }
});

export const demoToolOutputSchema = {
  ...closed({ Data: demoApprovedDataSchema }),
  'x-assistant-result-policy': {
    version: '1', allowedFieldPaths: ['Data', 'Data.TimeRange'], deniedFieldPaths: [], permissionMasks: [],
    limits: { maxDepth: 4, maxItems: 100, maxStringLength: 512, maxTotalBytes: 16 * 1024 },
    evidenceSafeProvenanceFields: ['Data.TimeRange']
  }
};

/** The Tool contract ties the response period to its fixed Connector operation. */
export function demoToolOutputSchemaFor(period: (typeof demoPeriods)[number]['wire']) {
  return {
    ...demoToolOutputSchema,
    properties: { Data: { ...demoApprovedDataSchema,
      properties: { ...demoApprovedDataSchema.properties,
        TimeRange: { ...(demoApprovedDataSchema.properties.TimeRange as Record<string, unknown>), enum: [period] } } } }
  };
}

export const demoManifest = {
  version: '1', connectorKey: 'business', operations: demoPeriods.map((period) => ({
    operationKey: `demo.shinmone.kpistats.${period.suffix}`, contractVersion: '1.0.0',
    inputSchema: closed({}, []), upstreamServiceRef: 'synthetic-shinmone-scm-api',
    request: { profile: 'GET_QUERY_V1', path: '/Dashboard/KpiStats',
      fixedQuery: { TimeRange: period.wire }, argumentMappings: [] },
    credentialProfileRef: 'shinmone-idx-bearer-v1', readOnly: true,
    response: { validationProfile: 'FULL_CLOSED_SCHEMA_V1', acceptedHttpStatuses: [200],
      acceptedApplicationCodes: [200], applicationCodePointer: '/Code', contentType: 'application/json',
      schema: closed({ Code: { type: 'integer' }, ExecutionTime: wireString,
        Message: wireString, Data: wireData }),
      extraction: [], structuredOutputSchema: closed({ Data: wireData }) },
    limits: { maxRequestBytes: 1024, maxResponseBytes: 16 * 1024, maxDepth: 5,
      maxItems: 20, maxStringLength: 512, timeoutMs: 1000 },
    errorMap: {}, readinessDependency: 'synthetic-shinmone-scm-api'
  }))
};

export function demoResponse(period: (typeof demoPeriods)[number]['wire']) {
  const ordinal = { today: 1, thisWeek: 2, thisMonth: 3 }[period];
  const metric = (base: number, rate = false) => {
    const Current = rate ? base + ordinal / 4 : base + ordinal * 10;
    const Previous = rate ? base - 1 : base + (ordinal - 1) * 10;
    const Change = Current - Previous;
    return { Current, Previous, Change, Trend: 'up',
      ChangePercentage: Previous === 0 ? 0 : Number(((Change / Previous) * 100).toFixed(2)) };
  };
  return {
    Code: 200, ExecutionTime: '2026-10-28T00:00:00Z', Message: 'OK',
    Data: {
      NewOrders: metric(1), CompletedOrders: metric(2), InProductionOrders: metric(3),
      AvgCompletionRate: metric(80, true), OverdueOrders: metric(4), TodayShipments: metric(5),
      LastUpdated: '2026-10-28T00:00:00Z', TimeRange: period
    }
  };
}
