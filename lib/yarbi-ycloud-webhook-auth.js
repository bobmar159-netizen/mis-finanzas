'use strict';

const crypto = require('node:crypto');

const SIGNATURE_HEADER = 'ycloud-signature';

function text(value, limit = 512) {
  return String(value ?? '').trim().slice(0, limit);
}

function rawBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return null;
}

function parseYCloudSignatureHeader(header) {
  const value = text(header, 1024);
  if (!value) return { ok: false, code: 'ycloud_signature_missing' };
  const parts = value.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length !== 2) return { ok: false, code: 'ycloud_signature_malformed' };
  const fields = new Map();
  for (const part of parts) {
    const match = /^([ts])=([^=\s]+)$/.exec(part);
    if (!match || fields.has(match[1])) return { ok: false, code: 'ycloud_signature_malformed' };
    fields.set(match[1], match[2]);
  }
  const timestamp = fields.get('t');
  const signature = fields.get('s');
  if (!/^\d{1,16}$/.test(timestamp || '') || !/^[a-fA-F0-9]{64}$/.test(signature || '')) {
    return { ok: false, code: 'ycloud_signature_malformed' };
  }
  return { ok: true, timestamp, signature: signature.toLowerCase() };
}

function verifyYCloudWebhookSignature({ rawBody, signatureHeader, secret } = {}) {
  // La clave se utiliza exactamente como fue configurada. Recortarla alteraría
  // una clave legítima que contenga espacios al inicio o final y haría fallar
  // una firma válida. Solo usamos trim para decidir si está vacía.
  const exactSecret = typeof secret === 'string' ? secret : String(secret ?? '');
  if (!exactSecret.trim()) return { ok: false, code: 'ycloud_webhook_secret_missing' };
  const parsed = parseYCloudSignatureHeader(signatureHeader);
  if (!parsed.ok) return parsed;
  const body = rawBuffer(rawBody);
  if (!body) return { ok: false, code: 'ycloud_raw_body_missing' };
  const prefix = Buffer.from(`${parsed.timestamp}.`, 'utf8');
  const expected = crypto.createHmac('sha256', exactSecret).update(Buffer.concat([prefix, body])).digest();
  const received = Buffer.from(parsed.signature, 'hex');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, code: 'ycloud_signature_invalid' };
  }
  return { ok: true, timestamp: parsed.timestamp };
}

function readHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

function authenticateYCloudWebhook({ rawBody, headers, secret } = {}) {
  const verification = verifyYCloudWebhookSignature({
    rawBody,
    signatureHeader: readHeader(headers, SIGNATURE_HEADER),
    secret
  });
  if (!verification.ok) return { authenticated: false, code: verification.code };
  return { authenticated: true, code: 'ycloud_authenticated', timestamp: verification.timestamp };
}

function extractYCloudInteractiveSelection(event = {}) {
  const source = event?.whatsappInboundMessage;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const interactive = source.interactive;
  if (!interactive || typeof interactive !== 'object' || Array.isArray(interactive)) return null;
  const declaredType = text(interactive.type, 64);
  const buttonId = text(interactive.button_reply?.id || interactive.buttonReply?.id, 120);
  const listId = text(interactive.list_reply?.id || interactive.listReply?.id, 120);
  if (declaredType === 'button_reply' && buttonId) return { type: 'button_reply', selection_id: buttonId };
  if (declaredType === 'list_reply' && listId) return { type: 'list_reply', selection_id: listId };
  return null;
}

module.exports = {
  SIGNATURE_HEADER,
  authenticateYCloudWebhook,
  extractYCloudInteractiveSelection,
  parseYCloudSignatureHeader,
  verifyYCloudWebhookSignature
};
