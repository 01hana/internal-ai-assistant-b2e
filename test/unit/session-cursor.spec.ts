import { BadRequestException } from '@nestjs/common';
import { decodeSessionCursor, encodeSessionCursor, parseSessionListLimit } from '../../src/assistant/session/session-cursor';

/** Feature 013 T037. */
describe('session list cursor and limit', () => {
  it('round-trips a cursor', () => {
    const cursor = { lastMessageAt: new Date('2026-11-16T05:00:00.123Z'), id: 'session-1' };
    expect(decodeSessionCursor(encodeSessionCursor(cursor))).toEqual(cursor);
  });

  it.each([
    '', '%%%', 'a'.repeat(201),
    Buffer.from('not json').toString('base64url'),
    Buffer.from(JSON.stringify(['x'])).toString('base64url'),
    Buffer.from(JSON.stringify({ t: '2026-11-16T05:00:00.000Z' })).toString('base64url'),
    Buffer.from(JSON.stringify({ t: 'yesterday', id: 's' })).toString('base64url'),
    Buffer.from(JSON.stringify({ t: '2026-11-16T05:00:00.000Z', id: 's', extra: 1 })).toString('base64url'),
    Buffer.from(JSON.stringify({ t: '2026-11-16T05:00:00.000Z', id: '' })).toString('base64url')
  ])('rejects a malformed or tampered cursor %#', (value) => {
    expect(() => decodeSessionCursor(value)).toThrow(BadRequestException);
  });

  it('defaults the limit to 20 and caps it at 50', () => {
    expect(parseSessionListLimit(undefined)).toBe(20);
    expect(parseSessionListLimit('50')).toBe(50);
    for (const value of ['0', '51', '-1', '1.5', 'abc', '1000']) expect(() => parseSessionListLimit(value)).toThrow(BadRequestException);
  });
});
