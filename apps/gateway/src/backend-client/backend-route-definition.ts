export type BackendRouteOperation =
  | 'create-session'
  | 'get-session'
  | 'get-session-messages'
  | 'send-stream-message';

export type BackendRouteDefinition = Readonly<{
  method: 'GET' | 'POST';
  path: string;
}>;

/** Server-owned fixed mappings for the existing protected Backend surface. */
export const BACKEND_ROUTE_DEFINITIONS: Readonly<Record<BackendRouteOperation, BackendRouteDefinition>> = Object.freeze({
  'create-session': Object.freeze({
    method: 'POST',
    path: '/api/v1/assistant/sessions'
  }),
  'get-session': Object.freeze({
    method: 'GET',
    path: '/api/v1/assistant/sessions/:id'
  }),
  'get-session-messages': Object.freeze({
    method: 'GET',
    path: '/api/v1/assistant/sessions/:id/messages'
  }),
  'send-stream-message': Object.freeze({
    method: 'POST',
    path: '/api/v1/assistant/sessions/:id/messages'
  })
});
