import { createPinnedLookupAdapter } from '../../src/idx/transport/pinned-lookup.adapter';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('pinned Node lookup adapter', () => {
  const lookup = createPinnedLookupAdapter(['8.8.8.8', '2606:4700:4700::1111']);

  it('returns every pinned address in Node all=true form', async () => {
    await expect(invoke(lookup, { all: true })).resolves.toEqual({ address: [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }] });
  });

  it('returns a single pinned result with the requested address family', async () => {
    await expect(invoke(lookup, { all: false })).resolves.toEqual({ address: '8.8.8.8', family: 4 });
    await expect(invoke(lookup, { family: 4 })).resolves.toEqual({ address: '8.8.8.8', family: 4 });
    await expect(invoke(lookup, { family: 6 })).resolves.toEqual({ address: '2606:4700:4700::1111', family: 6 });
  });

  it('fails closed when pinned addresses cannot satisfy the requested family', async () => {
    await expect(invoke(createPinnedLookupAdapter(['8.8.8.8']), { family: 6 })).rejects.toThrow('unsafe_destination');
  });

  it('adapts supplied pinned addresses without performing DNS', () => {
    const source = readFileSync(join(__dirname, '../../src/idx/transport/pinned-lookup.adapter.ts'), 'utf8');
    expect(source).not.toMatch(/node:dns|dns\/promises|lookup\s*\(/i);
  });
});

function invoke(lookup: ReturnType<typeof createPinnedLookupAdapter>, options: { all?: boolean; family?: number }): Promise<{ address: string | readonly { address: string; family: number }[]; family?: number }> {
  return new Promise((resolve, reject) => lookup('idx.customer.test', options, (error, address, family) => error ? reject(error) : resolve({ address, family })));
}
