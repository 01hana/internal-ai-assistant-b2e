import { readFileSync } from 'node:fs';
import type { AssistantExperienceConfigStore, StoredExperienceConfig } from '../../src/assistant-experience/assistant-experience.repository';
import type { AssistantExperiencePayloadV1 } from '../../src/assistant-experience/assistant-experience.types';
import { parseProvisionCliArguments } from '../../src/assistant-experience/provision-assistant-experience.cli';
import {
  ProvisionAssistantExperienceCommand,
  ProvisionAssistantExperienceError
} from '../../src/assistant-experience/provision-assistant-experience.command';

const raw = () => JSON.parse(readFileSync('test/fixtures/assistant-experience/customer-a.v1.json', 'utf8'));

class FakeStore implements AssistantExperienceConfigStore {
  rows: StoredExperienceConfig[] = [];
  activations = 0;
  async customerExists(customerId: string) { return customerId === 'customer-a'; }
  async findVersion(customerId: string, integrationId: string, configVersion: string) {
    return this.rows.find((row) => row.customerId === customerId && row.integrationId === integrationId &&
      row.configVersion === configVersion) ?? null;
  }
  async findActive(customerId: string, integrationId: string) {
    return this.rows.find((row) => row.customerId === customerId && row.integrationId === integrationId &&
      row.status === 'active') ?? null;
  }
  async activate(payload: AssistantExperiencePayloadV1, checksum: string) {
    this.activations += 1;
    for (const row of this.rows) if (row.status === 'active') Object.assign(row, { status: 'retired' });
    const existing = await this.findVersion(payload.customerId, payload.integrationId, payload.configVersion);
    if (existing) { Object.assign(existing, { status: 'active' }); return existing; }
    const row = { id: `row-${this.rows.length + 1}`, customerId: payload.customerId, integrationId: payload.integrationId,
      configVersion: payload.configVersion, status: 'active', checksum, source: 'provisioning', createdByUserId: null, createdAt: new Date(),
      activatedAt: new Date(), payload } as StoredExperienceConfig;
    this.rows.push(row);
    return row;
  }
}

describe('ProvisionAssistantExperienceCommand (Feature 013 T015)', () => {
  const passing = { validate: jest.fn(async () => []) };
  const setup = (validator = passing) => { const store = new FakeStore(); return { store, command: new ProvisionAssistantExperienceCommand(store, validator) }; };
  const code = async (work: Promise<unknown>) => {
    try { await work; return 'NO_ERROR'; } catch (error) { return error instanceof ProvisionAssistantExperienceError ? error.code : String(error); }
  };

  it('validates without writing in check mode', async () => {
    const { store, command } = setup();
    expect(await command.execute(raw(), { checkOnly: true, allowUnverified: false })).toMatchObject({ outcome: 'VALIDATED' });
    expect(store.activations).toBe(0);
  });

  it('activates a new version, is a no-op when re-run, and reactivates an older version', async () => {
    const { store, command } = setup();
    expect((await command.execute(raw(), { checkOnly: false, allowUnverified: false })).outcome).toBe('ACTIVATED');
    expect((await command.execute(raw(), { checkOnly: false, allowUnverified: false })).outcome).toBe('UNCHANGED');
    expect(store.activations).toBe(1);
    expect((await command.execute({ ...raw(), configVersion: '1.1.0' }, { checkOnly: false, allowUnverified: false })).outcome).toBe('ACTIVATED');
    expect((await command.execute(raw(), { checkOnly: false, allowUnverified: false })).outcome).toBe('REACTIVATED');
    expect(store.rows.filter((row) => row.status === 'active').map((row) => row.configVersion)).toEqual(['1.0.0']);
  });

  it('is independent of key order and formatting in the source file', async () => {
    const { command } = setup();
    const first = await command.execute(raw(), { checkOnly: true, allowUnverified: false });
    const reordered = Object.fromEntries(Object.entries(raw()).reverse());
    expect((await command.execute(reordered, { checkOnly: true, allowUnverified: false })).checksum).toBe(first.checksum);
  });

  it('rejects the same version with different content', async () => {
    const { store, command } = setup();
    await command.execute(raw(), { checkOnly: false, allowUnverified: false });
    const changed = raw(); changed.greeting.text = '不同的問候語';
    expect(await code(command.execute(changed, { checkOnly: false, allowUnverified: false }))).toBe('VERSION_CONFLICT');
    expect(await code(command.execute(changed, { checkOnly: true, allowUnverified: false }))).toBe('VERSION_CONFLICT');
    expect(store.activations).toBe(1);
  });

  it('requires HUMAN_VERIFIED content unless explicitly allowed', async () => {
    const { store, command } = setup();
    const draft = { ...raw(), semanticReviewStatus: 'NEEDS_HUMAN_REVIEW' };
    expect(await code(command.execute(draft, { checkOnly: false, allowUnverified: false }))).toBe('UNVERIFIED_CONTENT');
    expect((await command.execute(draft, { checkOnly: false, allowUnverified: true })).outcome).toBe('ACTIVATED');
    expect(store.activations).toBe(1);
  });

  it('rejects invalid payloads, pack mismatches and unknown Customers before writing', async () => {
    const failing = { validate: jest.fn(async () => [{ path: '$.quickReplies[1].message', code: 'MESSAGE_NOT_RESOLVED' }]) };
    const a = setup(); const b = setup(failing as never); const c = setup();
    expect(await code(a.command.execute({ ...raw(), version: '9' }, { checkOnly: false, allowUnverified: false }))).toBe('INVALID_PAYLOAD');
    expect(await code(b.command.execute(raw(), { checkOnly: false, allowUnverified: false }))).toBe('PACK_MISMATCH');
    expect(await code(c.command.execute({ ...raw(), customerId: 'customer-x' }, { checkOnly: false, allowUnverified: false }))).toBe('CUSTOMER_NOT_FOUND');
    expect(a.store.activations + b.store.activations + c.store.activations).toBe(0);
  });
});

describe('ProvisionAssistantExperienceCommand with the admin back-office (Feature 016 US4)', () => {
  const options = { checkOnly: false, allowUnverified: false };
  const savedInAdmin = async () => {
    const store = new FakeStore();
    const command = new ProvisionAssistantExperienceCommand(store, { validate: jest.fn(async () => []) });
    await command.execute(raw(), options);
    Object.assign(store.rows[0], { configVersion: '1.0.1', source: 'admin', createdByUserId: 'admin-user' });
    return { store, command };
  };
  const code = async (work: Promise<unknown>) => {
    try { await work; return 'NO_ERROR'; } catch (error) { return error instanceof ProvisionAssistantExperienceError ? error.code : String(error); }
  };

  it('does not replace a version saved in the admin, also in check mode', async () => {
    const { store, command } = await savedInAdmin();
    expect(await code(command.execute({ ...raw(), configVersion: '2.0.0' }, options))).toBe('ADMIN_MANAGED');
    expect(await code(command.execute({ ...raw(), configVersion: '2.0.0' }, { ...options, checkOnly: true }))).toBe('ADMIN_MANAGED');
    expect(store.activations).toBe(1);
  });

  it('replaces it with --force', async () => {
    const { store, command } = await savedInAdmin();
    expect((await command.execute({ ...raw(), configVersion: '2.0.0' }, { ...options, force: true })).outcome).toBe('ACTIVATED');
    expect(store.rows.find((row) => row.status === 'active')).toMatchObject({ configVersion: '2.0.0', source: 'provisioning' });
  });
});

describe('provision CLI arguments', () => {
  it('accepts --file with optional flags and rejects anything else', () => {
    expect(parseProvisionCliArguments(['--file', 'a.json'])).toEqual({ file: 'a.json', checkOnly: false, allowUnverified: false, force: false });
    expect(parseProvisionCliArguments(['--check', '--file', 'a.json', '--allow-unverified']))
      .toEqual({ file: 'a.json', checkOnly: true, allowUnverified: true, force: false });
    expect(parseProvisionCliArguments(['--force', '--file', 'a.json'])).toMatchObject({ force: true });
    for (const argv of [[], ['--file'], ['--file', '--check'], ['--file', 'a', '--file', 'b'], ['--force', '--force', '--file', 'a'], ['--yes', '--file', 'a']]) {
      expect(() => parseProvisionCliArguments(argv)).toThrow('Usage');
    }
  });
});
