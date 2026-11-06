'use strict';

const crypto = require('node:crypto');

function digest(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}

function createScopedAsyncCache({ ttlMs = 15000, maxEntries = 128, now = () => Date.now() } = {}) {
  const entries = new Map();
  const scopeHash = (ownerId, key) => digest(String(ownerId ?? '') + '\n' + stable(key));
  const tagHash = value => digest(String(value ?? ''));

  function trim() {
    const timestamp = now();
    for (const [key, entry] of entries) if (entry.expiresAt <= timestamp && !entry.pending) entries.delete(key);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  async function getOrLoad({ ownerId, key, contactIds = [], load } = {}) {
    if (!String(ownerId ?? '').trim()) throw new Error('scoped_cache_owner_required');
    if (typeof load !== 'function') throw new Error('scoped_cache_loader_required');
    const hash = scopeHash(ownerId, key);
    const timestamp = now();
    const existing = entries.get(hash);
    if (existing && existing.expiresAt > timestamp) {
      return { value: await existing.value, cache: existing.pending ? 'shared_inflight' : 'hit' };
    }
    const promise = Promise.resolve().then(load);
    entries.set(hash, {
      value: promise,
      pending: true,
      owner: tagHash(ownerId),
      contacts: new Set(contactIds.map(tagHash)),
      expiresAt: timestamp + Math.max(1, Number(ttlMs) || 1)
    });
    try {
      const value = await promise;
      const entry = entries.get(hash);
      if (entry) { entry.value = Promise.resolve(value); entry.pending = false; }
      trim();
      return { value, cache: 'miss' };
    } catch (error) {
      entries.delete(hash);
      throw error;
    }
  }

  function invalidate({ ownerId, contactId } = {}) {
    const owner = ownerId == null ? null : tagHash(ownerId);
    const contact = contactId == null ? null : tagHash(contactId);
    let removed = 0;
    for (const [key, entry] of entries) {
      if ((owner && entry.owner === owner) || (contact && entry.contacts.has(contact))) {
        entries.delete(key); removed += 1;
      }
    }
    return removed;
  }

  return { getOrLoad, invalidate, size: () => entries.size, clear: () => entries.clear() };
}

module.exports = { createScopedAsyncCache, stable };
