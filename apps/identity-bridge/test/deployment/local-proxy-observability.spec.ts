import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('local IDX proxy observability', () => {
  const configuration = readFileSync(join(__dirname, '../../deploy/idx-proxy.conf'), 'utf8');

  it('logs only the fixed MenuDetail method, path, statuses, and timings', () => {
    const format = configuration.match(/log_format\s+idx_safe\s+'([^']+)'\s*;/)?.[1];
    expect(format).toBe(
      'method=$request_method path=/APIs/Auth/APIs/Site/MenuDetail status=$status upstream_status=$upstream_status request_time=$request_time upstream_response_time=$upstream_response_time upstream_connect_time=$upstream_connect_time'
    );
    expect(format).not.toMatch(/authorization|cookie|token|request_body|response_body|request_uri|args|query|http_/i);
    expect(configuration).toMatch(/location = \/APIs\/Auth\/APIs\/Site\/MenuDetail \{\s*access_log \/dev\/stdout idx_safe;/);
  });

  it('retains bearer forwarding without placing it in the access log format', () => {
    expect(configuration).toContain('proxy_set_header Authorization $http_authorization;');
    const format = configuration.match(/log_format\s+idx_safe\s+'([^']+)'\s*;/)?.[1] ?? '';
    expect(format).not.toContain('$http_authorization');
  });
});
