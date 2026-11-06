'use strict';

// Esta capa es deliberadamente independiente del CRM. Solo clasifica el
// destinatario dedicado de Yarbi y remitentes previamente autorizados.
const crypto = require('node:crypto');

function text(value, limit = 256) {
  return String(value ?? '').trim().slice(0, limit);
}

function normalizeE164(value, { defaultCountryCode = '' } = {}) {
  let raw = text(value, 64).replace(/[\s().-]/g, '');
  if (raw.startsWith('00')) raw = '+' + raw.slice(2);
  if (!raw.startsWith('+') && defaultCountryCode) {
    const country = text(defaultCountryCode, 4).replace(/\D/g, '');
    const digits = raw.replace(/\D/g, '');
    raw = digits.startsWith(country) ? `+${digits}` : `+${country}${digits}`;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) return '';
  return raw;
}

function configuredIdentities(value, options = {}) {
  const rows = Array.isArray(value) ? value : [];
  const identities = [];
  const seen = new Set();
  for (const row of rows) {
    const source = typeof row === 'string' ? { phone: row } : (row && typeof row === 'object' ? row : null);
    if (!source) continue;
    const phone = normalizeE164(source.phone, options);
    const ownerKey = text(source.owner_key || source.ownerKey || 'primary', 80);
    const label = text(source.label || '', 48);
    if (!phone || !ownerKey || seen.has(phone)) continue;
    seen.add(phone);
    identities.push({ phone, owner_key: ownerKey, label });
  }
  return identities;
}

function requiredSecret(value) {
  const secret = typeof value === 'string' ? value : String(value ?? '');
  if (secret.trim().length < 16) {
    const error = new Error('owner_personal_identity_secret_missing');
    error.code = 'owner_personal_identity_secret_missing';
    throw error;
  }
  return secret;
}

function identityFingerprint(e164, secret) {
  return crypto.createHmac('sha256', requiredSecret(secret)).update(normalizeE164(e164), 'utf8').digest();
}

function safeEqual(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function resolveAuthorizedOwner({ senderPhone, authorizedIdentities, hmacSecret, options } = {}) {
  const normalized = normalizeE164(senderPhone, options);
  if (!normalized) return { outcome: 'identity_invalid', owner_key: null, identity_ref: null };
  const candidate = identityFingerprint(normalized, hmacSecret);
  for (const identity of configuredIdentities(authorizedIdentities, options)) {
    if (safeEqual(candidate, identityFingerprint(identity.phone, hmacSecret))) {
      return {
        outcome: 'authorized_owner',
        owner_key: identity.owner_key,
        // Correlación no reversible para trazas; nunca devuelve el teléfono.
        identity_ref: candidate.toString('hex').slice(0, 24),
        label: identity.label || null
      };
    }
  }
  return { outcome: 'sender_not_authorized', owner_key: null, identity_ref: candidate.toString('hex').slice(0, 24) };
}

function classifyOwnerPersonalInbound({ destinationPhone, senderPhone, personalDestinationPhone, authorizedIdentities, hmacSecret, options } = {}) {
  const destination = normalizeE164(destinationPhone, options);
  const configuredDestination = normalizeE164(personalDestinationPhone, options);
  if (!configuredDestination) return { scope: 'commercial', outcome: 'personal_destination_not_configured', owner_key: null };
  if (!destination || destination !== configuredDestination) return { scope: 'commercial', outcome: 'not_personal_destination', owner_key: null };
  const identity = resolveAuthorizedOwner({ senderPhone, authorizedIdentities, hmacSecret, options });
  if (identity.outcome !== 'authorized_owner') return { scope: 'rejected', outcome: identity.outcome, owner_key: null, identity_ref: identity.identity_ref || null };
  return { scope: 'owner_personal', outcome: 'authorized_owner', owner_key: identity.owner_key, identity_ref: identity.identity_ref, identity_label: identity.label };
}

function personalEventKey({ provider, providerEventId, messageId, hmacSecret } = {}) {
  const source = `${text(provider, 32)}:${text(providerEventId, 160)}:${text(messageId, 160)}`;
  if (!source.replace(/[:]/g, '')) {
    const error = new Error('owner_personal_event_identity_missing');
    error.code = 'owner_personal_event_identity_missing';
    throw error;
  }
  return crypto.createHmac('sha256', requiredSecret(hmacSecret)).update(source, 'utf8').digest('hex');
}

module.exports = {
  normalizeE164,
  configuredIdentities,
  identityFingerprint,
  resolveAuthorizedOwner,
  classifyOwnerPersonalInbound,
  personalEventKey
};
