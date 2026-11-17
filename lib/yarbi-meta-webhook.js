'use strict';

const crypto = require('node:crypto');

function rawBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return null;
}

function authenticateMetaWebhook({ rawBody, signatureHeader, appSecret } = {}) {
  const secret = typeof appSecret === 'string' ? appSecret : String(appSecret ?? '');
  if (!secret.trim()) return { authenticated: false, code: 'meta_webhook_secret_missing' };
  const match = /^sha256=([a-f0-9]{64})$/i.exec(String(signatureHeader || '').trim());
  if (!match) return { authenticated: false, code: signatureHeader ? 'meta_webhook_signature_malformed' : 'meta_webhook_signature_missing' };
  const body = rawBuffer(rawBody);
  if (!body) return { authenticated: false, code: 'meta_webhook_raw_body_missing' };
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const received = Buffer.from(match[1], 'hex');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { authenticated: false, code: 'meta_webhook_signature_invalid' };
  }
  return { authenticated: true, code: 'meta_webhook_authenticated' };
}

function boundedText(value, limit = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
}

function normalizeMetaReferral(referral, occurredAt) {
  if (!referral || typeof referral !== 'object' || Array.isArray(referral)) return null;
  const sourceType = boundedText(referral.source_type, 40).toLowerCase();
  const sourceId = boundedText(referral.source_id, 120);
  const clickId = boundedText(referral.ctwa_clid, 500);
  const sourceUrl = boundedText(referral.source_url, 1800);
  let safeUrl = '';
  try {
    const parsed = new URL(sourceUrl);
    if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) safeUrl = parsed.toString().slice(0, 1800);
  } catch (_) {}
  if (!sourceType && !sourceId && !clickId && !safeUrl) return null;
  const timestamp = Number(occurredAt);
  return {
    provider: 'meta',
    kind: sourceType === 'ad' || clickId ? 'click_to_whatsapp_ad' : 'meta_referral',
    source_type: sourceType || null,
    source_id: sourceId || null,
    ad_id: sourceType === 'ad' ? sourceId || null : null,
    ctwa_clid: clickId || null,
    source_url: safeUrl || null,
    headline: boundedText(referral.headline, 300) || null,
    body: boundedText(referral.body, 600) || null,
    occurred_at: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null
  };
}

function summarizeMetaAttribution(messages) {
  const touches = (Array.isArray(messages) ? messages : []).map(row => ({
    touch: row?.metadata?.meta_attribution,
    messageId: row?.id,
    at: Number(row?.timestamp || Date.parse(row?.metadata?.meta_attribution?.occurred_at || ''))
  })).filter(item => item.touch?.provider === 'meta' && Number.isFinite(item.at) && item.at > 0)
    .sort((left, right) => left.at - right.at);
  if (!touches.length) return { status: 'unavailable', reason: 'no_verified_meta_referral' };
  const present = item => ({ ...item.touch, message_id: boundedText(item.messageId, 180) || null });
  return {
    status: 'verified_referral_touches',
    basis: 'signed_meta_whatsapp_webhook',
    first_touch: present(touches[0]),
    last_touch: present(touches[touches.length - 1]),
    touch_count: touches.length
  };
}

module.exports = { authenticateMetaWebhook, normalizeMetaReferral, summarizeMetaAttribution };
