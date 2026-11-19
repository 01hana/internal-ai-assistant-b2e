/** How a back-office actor is shown: developers stay anonymous to everyone but developers (014 US5-3). */
export type AuditActorView = { account: string | null; label: string };

export const DEVELOPER_LABEL = '開發工程師';

export function auditActorView(event: { actorAccount: string | null; actorIsDeveloper: boolean }, viewerIsDeveloper: boolean): AuditActorView {
  if (event.actorIsDeveloper && !viewerIsDeveloper) return { account: null, label: DEVELOPER_LABEL };
  return { account: event.actorAccount, label: event.actorAccount ?? '—' };
}
