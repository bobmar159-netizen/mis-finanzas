'use strict';

const crypto = require('node:crypto');

// Herramientas puras de diagnóstico. Este módulo no hace red, no conoce una
// API key y no altera el contrato de comprensión usado en producción.
const INVALID_ARGUMENT_CATEGORIES = Object.freeze({
  SCHEMA_UNSUPPORTED: 'SCHEMA_UNSUPPORTED',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  MODEL_CONFIGURATION_INVALID: 'MODEL_CONFIGURATION_INVALID',
  GENERATION_CONFIG_INVALID: 'GENERATION_CONFIG_INVALID',
  REQUEST_FIELD_UNSUPPORTED: 'REQUEST_FIELD_UNSUPPORTED',
  SDK_SERIALIZATION_ERROR: 'SDK_SERIALIZATION_ERROR',
  PROVIDER_INVALID_ARGUMENT_UNKNOWN: 'PROVIDER_INVALID_ARGUMENT_UNKNOWN'
});

const SUPPORTED_JSON_SCHEMA_KEYWORDS = new Set([
  '$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title', 'description',
  'enum', 'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum',
  'anyOf', 'oneOf', 'properties', 'additionalProperties', 'required',
  'propertyOrdering'
]);

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeText(value, limit = 1200) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit);
}

function structuredDetailSignal(details) {
  if (!Array.isArray(details)) return '';
  const fragments = [];
  for (const item of details.slice(0, 8)) {
    const detail = plainObject(item);
    for (const key of ['reason', 'field', 'description']) {
      const value = safeText(detail[key], 240);
      if (value) fragments.push(value);
    }
    const violations = Array.isArray(detail.fieldViolations) ? detail.fieldViolations : [];
    for (const itemViolation of violations.slice(0, 8)) {
      const violation = plainObject(itemViolation);
      const field = safeText(violation.field, 160);
      const description = safeText(violation.description, 240);
      if (field) fragments.push(field);
      if (description) fragments.push(description);
    }
  }
  return fragments.join(' ').slice(0, 1600);
}

function providerErrorView(errorLike) {
  const source = plainObject(errorLike);
  const nested = plainObject(source.error);
  return {
    http_status: Number(source.http_status || source.httpStatus || source.statusCode || source.status || nested.code) || null,
    provider_status: safeText(source.provider_status || source.providerStatus || nested.status, 80) || null,
    reason: safeText(source.reason || source.code || nested.reason, 120) || null,
    message: safeText(source.message || nested.message, 1200) || null,
    structured_detail_signal: structuredDetailSignal(source.details || nested.details) || null
  };
}

function classifyGeminiInvalidArgument(errorLike) {
  const view = providerErrorView(errorLike);
  const signal = `${view.provider_status || ''} ${view.reason || ''} ${view.message || ''} ${view.structured_detail_signal || ''}`.toLowerCase();
  let category = INVALID_ARGUMENT_CATEGORIES.PROVIDER_INVALID_ARGUMENT_UNKNOWN;

  if (/serializ|circular|bigint|json\.stringify|cannot convert.*json/.test(signal)) {
    category = INVALID_ARGUMENT_CATEGORIES.SDK_SERIALIZATION_ERROR;
  } else if (/model.*(not supported|unsupported|invalid|does not support)|unsupported.*model/.test(signal)) {
    category = INVALID_ARGUMENT_CATEGORIES.MODEL_CONFIGURATION_INVALID;
  } else if (/(too many states for serving|schema complexity)/.test(signal) || (/(response.?json.?schema|json schema|schema)/.test(signal) && /(too complex|complexity|unsupported keyword|not supported|unsupported feature)/.test(signal))) {
    category = INVALID_ARGUMENT_CATEGORIES.SCHEMA_UNSUPPORTED;
  } else if (/generation.?config|temperature|response.?mime.?type/.test(signal) && /(invalid|unsupported|unknown|not supported)/.test(signal)) {
    category = INVALID_ARGUMENT_CATEGORIES.GENERATION_CONFIG_INVALID;
  } else if (/(response.?json.?schema|json schema|schema)/.test(signal) && /(invalid|malformed|required|constraint|type|enum|property)/.test(signal)) {
    category = INVALID_ARGUMENT_CATEGORIES.SCHEMA_INVALID;
  } else if (/(unknown field|unrecognized field|unsupported field|field .* not supported)/.test(signal)) {
    category = INVALID_ARGUMENT_CATEGORIES.REQUEST_FIELD_UNSUPPORTED;
  }

  return {
    category,
    http_status: view.http_status,
    provider_status: view.provider_status,
    // No se devuelve ni persiste el mensaje del proveedor. Solo señales
    // booleanas que permiten auditar por qué se eligió una categoría.
    signals: {
      invalid_argument: /invalid.?argument/.test(signal),
      mentions_schema: /schema/.test(signal),
      mentions_complexity: /(too complex|complexity|too many states for serving)/.test(signal),
      mentions_model: /model/.test(signal),
      mentions_generation_config: /generation.?config/.test(signal),
      mentions_unknown_field: /(unknown field|unrecognized field|unsupported field)/.test(signal)
    }
  };
}

function schemaSha256(schema) {
  return crypto.createHash('sha256').update(JSON.stringify(schema || {})).digest('hex');
}

function schemaStatistics(schema) {
  const stats = {
    serialized_bytes: Buffer.byteLength(JSON.stringify(schema || {})),
    node_count: 0,
    object_count: 0,
    array_count: 0,
    property_count: 0,
    required_entry_count: 0,
    enum_count: 0,
    enum_value_count: 0,
    max_items_total: 0,
    max_depth: 0,
    nullable_type_array_count: 0,
    unsupported_keywords: []
  };
  const unsupported = new Set();

  function walk(value, depth = 0, schemaPosition = false) {
    stats.max_depth = Math.max(stats.max_depth, depth);
    if (Array.isArray(value)) {
      stats.node_count += 1;
      stats.array_count += 1;
      for (const item of value) walk(item, depth + 1, false);
      return;
    }
    if (!value || typeof value !== 'object') return;
    stats.node_count += 1;
    stats.object_count += 1;
    if (schemaPosition) {
      for (const key of Object.keys(value)) if (!SUPPORTED_JSON_SCHEMA_KEYWORDS.has(key)) unsupported.add(key);
    }
    if (value.properties && typeof value.properties === 'object') stats.property_count += Object.keys(value.properties).length;
    if (Array.isArray(value.required)) stats.required_entry_count += value.required.length;
    if (Array.isArray(value.enum)) { stats.enum_count += 1; stats.enum_value_count += value.enum.length; }
    if (Number.isFinite(value.maxItems)) stats.max_items_total += value.maxItems;
    if (Array.isArray(value.type) && value.type.includes('null')) stats.nullable_type_array_count += 1;

    for (const [key, nested] of Object.entries(value)) {
      if (key === 'properties' && nested && typeof nested === 'object') {
        for (const child of Object.values(nested)) walk(child, depth + 1, true);
      } else if (['items', 'prefixItems'].includes(key)) {
        walk(nested, depth + 1, true);
      } else if (['anyOf', 'oneOf'].includes(key) && Array.isArray(nested)) {
        for (const child of nested) walk(child, depth + 1, true);
      } else {
        walk(nested, depth + 1, false);
      }
    }
  }

  walk(schema, 0, true);
  stats.unsupported_keywords = Array.from(unsupported).sort();
  return stats;
}

function sanitizedLogicalRequest(url, options = {}) {
  const headers = plainObject(options.headers);
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : plainObject(options.body);
  return {
    url: String(url),
    method: safeText(options.method, 16) || 'GET',
    header_names: Object.keys(headers).map(name => name.toLowerCase()).sort(),
    authentication: headers['x-goog-api-key'] || headers['X-Goog-Api-Key'] ? 'x-goog-api-key:[REDACTED]' : 'missing',
    body
  };
}

module.exports = {
  INVALID_ARGUMENT_CATEGORIES,
  SUPPORTED_JSON_SCHEMA_KEYWORDS,
  classifyGeminiInvalidArgument,
  schemaSha256,
  schemaStatistics,
  sanitizedLogicalRequest
};
