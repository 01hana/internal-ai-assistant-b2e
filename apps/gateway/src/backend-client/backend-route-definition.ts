export type BackendRouteOperation =
  | 'create-session'
  | 'get-session'
  | 'get-session-messages'
  | 'send-stream-message'
  | 'list-sessions'
  | 'archive-session'
  | 'unarchive-session'
  | 'delete-session';

export type BackendRouteDefinition = Readonly<{
  method: 'GET' | 'POST' | 'DELETE';
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
  }),
  'list-sessions': Object.freeze({
    method: 'GET',
    path: '/api/v1/assistant/sessions'
  }),
  'archive-session': Object.freeze({
    method: 'POST',
    path: '/api/v1/assistant/sessions/:id/archive'
  }),
  'unarchive-session': Object.freeze({
    method: 'POST',
    path: '/api/v1/assistant/sessions/:id/unarchive'
  }),
  'delete-session': Object.freeze({
    method: 'DELETE',
    path: '/api/v1/assistant/sessions/:id'
  })
});
