export type BackendRouteOperation =
  | 'create-session'
  | 'send-stream-message';

export type BackendRouteDefinition = Readonly<{
  method: 'POST';
  path: string;
}>;

/** Server-owned fixed mappings for the existing protected Backend surface. */
export const BACKEND_ROUTE_DEFINITIONS: Readonly<Record<BackendRouteOperation, BackendRouteDefinition>> = Object.freeze({
  'create-session': Object.freeze({
    method: 'POST',
    path: '/api/v1/assistant/sessions'
  }),
  'send-stream-message': Object.freeze({
    method: 'POST',
    path: '/api/v1/assistant/sessions/:id/messages'
  })
});
