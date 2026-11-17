'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createOAuthState, decryptAccessToken, encryptAccessToken, graphUrl, hash,
  isPreviewMetaRedirectAllowed, normalizeInsight, normalizeMetaAdAccount, verifyOAuthState
} = require('../lib/yarbi-meta-marketing');

const ownerId = 'f95a3c9c-232d-4fe4-a50a-35981386fc15';
const secret = 'local-only-test-secret-which-is-long-enough-123456';

test('Meta OAuth state is signed, owner-bound, and expires', () => {
  const now = 1793372400000;
  const state = createOAuthState({ ownerId, secret, now });
  assert.equal(verifyOAuthState(state, { secret, now: now + 1000 }).ownerId, ownerId);
  assert.equal(verifyOAuthState(state, { secret: 'wrong-secret', now }).ok, false);
  assert.equal(verifyOAuthState(state, { secret, now: now + 10 * 60 * 1000 }).code, 'meta_oauth_state_expired');
  assert.match(hash(state), /^[a-f0-9]{64}$/);
});

test('Meta access token ciphertext is authenticated and owner-scoped', () => {
  const encrypted = encryptAccessToken('synthetic-token-not-a-credential', { key: secret, ownerId });
  assert.equal(decryptAccessToken(encrypted, { key: secret, ownerId }), 'synthetic-token-not-a-credential');
  assert.throws(() => decryptAccessToken(encrypted, { key: secret, ownerId: '210b8316-26e0-4290-9b14-7f4f65ff219b' }));
  assert.throws(() => decryptAccessToken({ ...encrypted, data: 'AA==' }, { key: secret, ownerId }));
});

test('Marketing API URLs and insight rows use a fixed Graph host and validated account metrics', () => {
  const url = graphUrl('act_123456/insights', { level: 'ad', limit: 100 }, 'v27.0');
  assert.equal(url.hostname, 'graph.facebook.com');
  assert.equal(url.pathname, '/v27.0/act_123456/insights');
  assert.equal(normalizeMetaAdAccount({ id: 'act_123456', name: 'Cuenta', currency: 'PEN' }).ad_account_id, 'act_123456');
  assert.equal(normalizeMetaAdAccount({ id: 'act_bad' }), null);
  const row = normalizeInsight({ ad_id: '123456', date_start: '2026-11-16', spend: '12.75', impressions: '500', clicks: '18', actions: [{ action_type: 'lead', value: '2' }] }, 'act_123456', ownerId);
  assert.equal(row.spend, 12.75);
  assert.equal(row.clicks, 18);
  assert.equal(normalizeInsight({ ad_id: '123456', date_start: '2026-11-16', spend: '-1' }, 'act_123456', ownerId), null);
});

test('Meta OAuth redirect accepts only the Vercel Preview branch host, never the Production project domain', () => {
  const branchHost = 'yarbi-preview-candidate-20261105-git-codex-yarbi-core-domain-omar-dfc4.vercel.app';
  const productionHost = 'yarbi-preview-candidate-20261105.vercel.app';
  assert.equal(isPreviewMetaRedirectAllowed({ vercelEnv: 'preview', expectedHost: branchHost, branchUrl: branchHost, productionUrl: productionHost, redirectUri: `https://${branchHost}/api/assistant/meta-ads?action=callback` }), true);
  assert.equal(isPreviewMetaRedirectAllowed({ vercelEnv: 'preview', expectedHost: productionHost, branchUrl: branchHost, productionUrl: productionHost, redirectUri: `https://${productionHost}/api/assistant/meta-ads?action=callback` }), false);
  assert.equal(isPreviewMetaRedirectAllowed({ vercelEnv: 'production', expectedHost: branchHost, branchUrl: branchHost, productionUrl: productionHost, redirectUri: `https://${branchHost}/api/assistant/meta-ads?action=callback` }), false);
});
