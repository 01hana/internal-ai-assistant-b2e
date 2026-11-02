import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function array(raw, label) {
  if (raw === undefined) return [];
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`${label} is not valid JSON.`); }
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function scopedKey(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.customerId !== 'string' || typeof value.integrationId !== 'string' ||
      typeof value.hostApp !== 'string') throw new Error(`${label} has no trusted scope.`);
  return `${value.customerId}\u0000${value.integrationId}\u0000${value.hostApp}`;
}

export function mergeScopedLocalEntries(raw, replacement, target, label) {
  const old = array(raw, label);
  const targetKey = scopedKey(target, label);
  const seen = new Set();
  const preserved = [];
  for (const entry of old) {
    const key = scopedKey(entry, label);
    if (seen.has(key)) throw new Error(`${label} has duplicate integration scope.`);
    seen.add(key);
    if (key !== targetKey) preserved.push(entry);
  }
  if (scopedKey(replacement, label) !== targetKey) throw new Error(`${label} replacement scope differs.`);
  return JSON.stringify([...preserved, replacement]);
}

export function mergeLocalCapabilityPaths(raw, replacementPath, target, root) {
  const paths = array(raw, 'Capability Pack paths');
  const targetKey = `${target.customerId}\u0000${target.integrationId}`;
  const replacement = JSON.parse(readFileSync(resolve(root, replacementPath), 'utf8'));
  if (replacement.customerId !== target.customerId || replacement.integrationId !== target.integrationId ||
      !Array.isArray(replacement.hostApps) || !replacement.hostApps.includes(target.hostApp)) {
    throw new Error('Replacement Capability Pack has the wrong scope.');
  }
  const seen = new Set();
  const preserved = [];
  for (const path of paths) {
    if (typeof path !== 'string') throw new Error('Capability Pack path is invalid.');
    const pack = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    if (!pack || typeof pack.customerId !== 'string' || typeof pack.integrationId !== 'string' ||
        !Array.isArray(pack.hostApps) || pack.hostApps.some((host) => typeof host !== 'string')) {
      throw new Error('Capability Pack has no trusted scope.');
    }
    const key = `${pack.customerId}\u0000${pack.integrationId}`;
    if (seen.has(key)) throw new Error('Capability Packs have duplicate integration scope.');
    seen.add(key);
    if (key !== targetKey) preserved.push(path);
  }
  return JSON.stringify([...preserved, replacementPath]);
}

export function mergeLocalServiceKeys(raw, replacement) {
  const old = array(raw, 'Connector service keys');
  const seen = new Set();
  const preserved = [];
  for (const entry of old) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        typeof entry.profileKey !== 'string') throw new Error('Connector service key profile is invalid.');
    if (seen.has(entry.profileKey)) throw new Error('Connector service key profile is duplicated.');
    seen.add(entry.profileKey);
    if (entry.profileKey === replacement.profileKey) {
      if (JSON.stringify(entry) !== JSON.stringify(replacement)) {
        throw new Error('Connector service key profile is already configured differently.');
      }
    } else preserved.push(entry);
  }
  return JSON.stringify([...preserved, replacement]);
}

export function assertDedicatedShinmoneRuntime(raw, target) {
  const contexts = array(raw, 'Connector Runtime contexts');
  if (contexts.length && (contexts.length !== 1 ||
      scopedKey(contexts[0], 'Connector Runtime context') !== scopedKey(target, 'Connector Runtime context'))) {
    throw new Error('The local Connector Runtime also serves another integration; mode switch is blocked.');
  }
}
