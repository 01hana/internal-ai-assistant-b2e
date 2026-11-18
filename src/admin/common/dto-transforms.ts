import { Transform } from 'class-transformer';

/** Trims surrounding whitespace of string input before validation. */
export const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Trims and lower-cases string input (accounts and emails are stored in lower case). */
export const trimLower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
