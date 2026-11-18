/** Injectable time source so expiry, lockout and idle rules can be tested without waiting. */
export const ADMIN_CLOCK = Symbol('ADMIN_CLOCK');
export type AdminClock = () => Date;
export const systemClock: AdminClock = () => new Date();
