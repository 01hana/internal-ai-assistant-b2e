import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SendAssistantMessageDto } from '../../src/assistant/dto/assistant.dto';

/** Feature 013 T021 / FR-005: exactly one of message or choiceId. */
describe('SendAssistantMessageDto', () => {
  const errors = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(SendAssistantMessageDto, body))).map((error) => error.property);

  it.each([
    ['a message', { message: '查詢訂單狀態' }],
    ['a choiceId', { choiceId: 'order-status-10001' }],
    ['a choiceId with page context', { choiceId: 'overview', pageContext: { module: 'orders' } }]
  ])('accepts %s', async (_label, body) => {
    expect(await errors(body)).toEqual([]);
  });

  it.each([
    ['neither', {}, 'message'],
    ['both', { message: '查詢', choiceId: 'overview' }, 'choiceId'],
    ['an empty message', { message: '' }, 'message'],
    ['an uppercase choiceId', { choiceId: 'Overview' }, 'choiceId'],
    ['a choiceId with spaces', { choiceId: 'has space' }, 'choiceId'],
    ['an over-long choiceId', { choiceId: `a${'b'.repeat(64)}` }, 'choiceId'],
    ['a non-string choiceId', { choiceId: 7 }, 'choiceId']
  ])('rejects %s', async (_label, body, property) => {
    expect(await errors(body)).toContain(property);
  });
});
