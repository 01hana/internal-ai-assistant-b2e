#!/usr/bin/env node
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { HOSTS_BEGIN, HOSTS_END, updateHostsContent } from './local-lib.mjs';

const index = process.argv.indexOf('--ip');
const ip = index >= 0 ? process.argv[index + 1] : undefined;
if (!ip || process.getuid?.() !== 0) {
  process.stderr.write('This helper must run as root with --ip <active-lan-ip>.\n');
  process.exit(1);
}
const path = '/etc/hosts';
const before = readFileSync(path, 'utf8');
const after = updateHostsContent(before, ip);
if (before !== after) {
  const backup = `/etc/hosts.internal-ai-assistant-local.bak`;
  copyFileSync(path, backup);
  writeFileSync(path, after, { mode: 0o644 });
}
process.stdout.write(`${HOSTS_BEGIN} updated; backup is /etc/hosts.internal-ai-assistant-local.bak; ${HOSTS_END}\n`);
