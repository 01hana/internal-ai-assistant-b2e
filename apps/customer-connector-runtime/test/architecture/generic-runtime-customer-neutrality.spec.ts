import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PRODUCTION_ROOT = join(__dirname, '../../src');
const FORBIDDEN = [
  'shinmone',
  '/Dashboard/KPIStats',
  'Dashboard/KPIStats',
  'NewOrders',
  'TimeRange',
  'thisMonth',
  'shinmone-idx-bearer-v1',
  'SCM_DASHBOARD',
  'customer-shinmone-scm-local',
  'shinmone-scm-assistant-local'
] as const;

describe('generic Connector Runtime customer-neutrality guard', () => {
  it('contains no Shinmone-specific vocabulary in generic production source', () => {
    const violations = productionFiles(PRODUCTION_ROOT).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return FORBIDDEN
        .filter((term) => source.toLowerCase().includes(term.toLowerCase()))
        .map((term) => `${relative(PRODUCTION_ROOT, file)}:${term}`);
    });

    expect(violations).toEqual([]);
  });
});

function productionFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? productionFiles(path) : [path];
    })
    .filter((path) => path.endsWith('.ts'));
}
