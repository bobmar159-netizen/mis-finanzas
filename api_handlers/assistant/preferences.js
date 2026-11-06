const crypto = require('crypto');
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');

let SUPABASE_URL = '';
let SUPABASE_KEY = '';
const ASSISTANT_TOKEN = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const AUDIT_TEST_ENABLED = String(process.env.AUDIT_TEST || '').trim().toLowerCase() === 'true';
const YARBI_VAULT_KEY = process.env.YARBI_VAULT_KEY || '';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Assistant-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
function tokenFrom(req) {
  return String(req.headers?.['x-assistant-token'] || req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
}
function authorized(req) {
  const token = tokenFrom(req);
  return Boolean(ASSISTANT_TOKEN && token && token === ASSISTANT_TOKEN);
}
function ownerKey(req) {
  return crypto.createHash('sha256').update(tokenFrom(req)).digest('hex');
}
async function supabase(path, options = {}) {
  const response = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
function clean(value, max = 1000) { return String(value || '').trim().slice(0, max); }
function responseError(res, status, error, code = '') {
  return res.status(status).json({ ok: false, error, ...(code ? { code } : {}) });
}
function vaultEncryptionKey() {
  if (!YARBI_VAULT_KEY) throw new Error('Falta YARBI_VAULT_KEY');
  return crypto.createHash('sha256').update(YARBI_VAULT_KEY, 'utf8').digest();
}
function safeVaultSecrets(value) {
  const source = value && typeof value === 'object' ? value : {};
  const limits = { sheetsUrl: 3000, notionToken: 800, geminiKey: 800, assistantToken: 800, elevenKey: 800 };
  const result = {};
  Object.entries(limits).forEach(([key, max]) => {
    if (source[key] !== undefined && source[key] !== null) result[key] = String(source[key]).trim().slice(0, max);
  });
  return result;
}
function vaultStatus(secrets) {
  const source = safeVaultSecrets(secrets);
  return {
    sheets: Boolean(source.sheetsUrl),
    notion: Boolean(source.notionToken),
    gemini: Boolean(source.geminiKey),
    yarbi: Boolean(source.assistantToken),
    elevenLabs: Boolean(source.elevenKey),
    count: Object.values(source).filter(Boolean).length
  };
}
function encryptVault(secrets, userId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(String(userId), 'utf8'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(safeVaultSecrets(secrets)), 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
    updatedAt: new Date().toISOString()
  };
}
function decryptVault(payload, userId) {
  if (!payload || payload.version !== 1 || !payload.iv || !payload.tag || !payload.data) return {};
  const decipher = crypto.createDecipheriv('aes-256-gcm', vaultEncryptionKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAAD(Buffer.from(String(userId), 'utf8'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
  return safeVaultSecrets(JSON.parse(decrypted));
}
async function readAccountSettingsRow(userId) {
  const result = await supabase('/rest/v1/yarbi_user_settings?user_id=eq.' + encodeURIComponent(String(userId)) + '&select=settings,updated_at&limit=1');
  if (!result.response.ok) throw new Error(result.data?.message || 'No se pudieron leer las configuraciones');
  return Array.isArray(result.data) ? (result.data[0] || null) : null;
}
async function writeAccountSettingsRow(userId, settings) {
  const result = await supabase('/rest/v1/yarbi_user_settings?on_conflict=user_id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: userId, settings })
  });
  if (!result.response.ok) throw new Error(result.data?.message || 'No se pudieron guardar las configuraciones');
  return result;
}
function authCallbackPage(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Activar Yarbi</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f1f5f9;color:#172033;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px}
.card{max-width:420px;width:100%;background:#fff;border-radius:20px;padding:28px;box-shadow:0 12px 35px #0f172a18;text-align:center}
h1{font-size:24px;margin:0 0 10px}p{line-height:1.5;color:#475569}
button{border:0;border-radius:12px;background:#0f766e;color:#fff;font-size:16px;font-weight:800;padding:13px 22px;cursor:pointer;margin-top:12px}
small{display:block;margin-top:16px;color:#64748b}
</style>
</head>
<body>
<main class="card">
<div style="font-size:44px">🟢</div>
<h1>Correo verificado</h1>
<p>Tu enlace de Yarbi está listo. Pulsa el botón para regresar a la aplicación.</p>
<button id="open-app" type="button">Abrir Yarbi</button>
<small>Si Android pregunta con qué aplicación abrirlo, selecciona Yarbi.</small>
</main>
<script>
(function(){
  const appUrl = 'com.misfinanzas.app://auth/callback' + window.location.search + window.location.hash;
  document.getElementById('open-app').addEventListener('click', function(){ window.location.href = appUrl; });
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
  if (params.get('error_description') || params.get('error')) {
    document.querySelector('h1').textContent = 'No se pudo validar el enlace';
    document.querySelector('p').textContent = params.get('error_description') || params.get('error');
    document.getElementById('open-app').style.display = 'none';
  }
})();
</script>
</body>
</html>`);
}
function userBearerFrom(req) {
  return String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
}
async function authenticatedSupabaseUser(req) {
  const accessToken = userBearerFrom(req);
  const apiKey = SUPABASE_PUBLISHABLE_KEY || SUPABASE_KEY;
  if (!accessToken || !apiKey) return null;
  const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: apiKey, Authorization: 'Bearer ' + accessToken }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}
function safeAccountSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const limits = { theme:300, voiceProvider:300, geminiLiveVoice:300, elevenVoiceId:300, elevenModel:300, elevenStability:300, elevenSimilarity:300, elevenStyle:300, notionDbId:300, notionClientsDbId:300, notionInterval:300, yarbiAutonomy:2000, yarbiClientResolutions:60000 };
  const result = {};
  Object.entries(limits).forEach(([key,max]) => {
    if (source[key] !== undefined && source[key] !== null) result[key] = String(source[key]).slice(0, max);
  });
  return result;
}
function safeDebtPayment(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: clean(source.id, 120),
    cuota: Number(source.cuota || source.cuotaNum || 0),
    fecha: clean(source.fecha, 20),
    monto: Number(source.monto || 0),
    montoInteres: Number(source.montoInteres || 0),
    montoCapital: Number(source.montoCapital || 0),
    txId: clean(source.txId, 120),
    autoDeuda: Boolean(source.autoDeuda),
    afectaBalance: source.afectaBalance !== false,
    historico: Boolean(source.historico)
  };
}
function safeDebtRecord(value) {
  const source = value && typeof value === 'object' ? value : {};
  const notes = clean(source.notas || source.notes, 2000);
  return {
    id: clean(source.id, 120),
    name: clean(source.name, 240),
    tipo: clean(source.tipo, 80),
    tipoLabel: clean(source.tipoLabel, 120),
    rol: clean(source.rol || source.deudaRol, 30),
    deudaRol: clean(source.deudaRol || source.rol, 30),
    categoria: clean(source.categoria, 80),
    notas: notes,
    notes,
    totalAmount: Number(source.totalAmount || 0),
    cuotaMonto: Number(source.cuotaMonto || 0),
    cuotaMontoFixed: Number(source.cuotaMontoFixed || 0),
    cuotasTotales: Number(source.cuotasTotales || 0),
    cuotasPagadas: Number(source.cuotasPagadas || 0),
    fechaInicio: clean(source.fechaInicio, 20),
    fechaVencimiento: clean(source.fechaVencimiento, 20),
    diaPago: Number(source.diaPago || 0),
    repeticion: clean(source.repeticion, 40),
    seguroMonto: Number(source.seguroMonto || 0),
    tea: Number(source.tea || 0),
    capital: Number(source.capital || 0),
    tasaMensual: Number(source.tasaMensual || 0),
    sistema: clean(source.sistema, 40),
    capitalPendiente: Number(source.capitalPendiente || 0),
    color: clean(source.color, 30),
    _remoteReceivableId: clean(source._remoteReceivableId, 120),
    _migratedFrom: clean(source._migratedFrom, 120),
    createdAt: clean(source.createdAt, 40),
    updatedAt: clean(source.updatedAt, 40),
    pagos: (Array.isArray(source.pagos) ? source.pagos : []).slice(0, 240).map(safeDebtPayment)
  };
}
function safeDebtItems(value) {
  return (Array.isArray(value) ? value : []).slice(0, 250).map(safeDebtRecord).filter(item => item.id && item.name);
}
async function handleAccountDebts(req, res) {
  const user = await authenticatedSupabaseUser(req);
  if (!user?.id) return responseError(res, 401, 'Sesión de correo no válida o expirada');
  const mode = clean(req.query?.mode || req.body?.mode || 'negocio', 20) === 'personal' ? 'personal' : 'negocio';
  const row = await readAccountSettingsRow(user.id);
  const currentSettings = row?.settings && typeof row.settings === 'object' ? row.settings : {};
  const debtStore = currentSettings.__debts && typeof currentSettings.__debts === 'object'
    ? currentSettings.__debts
    : { version: 1, modes: {} };
  if (req.method === 'GET') {
    const snapshot = debtStore.modes?.[mode] || null;
    return res.status(200).json({
      ok: true,
      mode,
      configured: Boolean(snapshot),
      debts: safeDebtItems(snapshot?.items),
      updatedAt: snapshot?.updatedAt || null,
      source: snapshot ? 'supabase-account' : 'empty'
    });
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const debts = safeDebtItems(body.debts);
  const updatedAt = new Date().toISOString();
  const nextDebtStore = {
    version: 1,
    modes: {
      ...(debtStore.modes && typeof debtStore.modes === 'object' ? debtStore.modes : {}),
      [mode]: { items: debts, updatedAt }
    }
  };
  await writeAccountSettingsRow(user.id, { ...currentSettings, __debts: nextDebtStore });
  const readBack = await readAccountSettingsRow(user.id);
  const confirmed = safeDebtItems(readBack?.settings?.__debts?.modes?.[mode]?.items);
  if (confirmed.length !== debts.length || confirmed.some((item, index) => item.id !== debts[index]?.id)) {
    return responseError(res, 502, 'Supabase no confirmó la copia completa de deudas');
  }
  return res.status(200).json({ ok: true, mode, saved: true, count: confirmed.length, updatedAt, source: 'supabase-account' });
}
async function handleAccountSettings(req, res) {
  const user = await authenticatedSupabaseUser(req);
  if (!user?.id) return responseError(res, 401, 'Sesión de correo no válida o expirada');
  if (req.method === 'GET') {
    const row = await readAccountSettingsRow(user.id);
    return res.status(200).json({ ok: true, settings: safeAccountSettings(row?.settings), updatedAt: row?.updated_at || null });
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const incoming = safeAccountSettings(body.settings);
  const row = await readAccountSettingsRow(user.id);
  const current = row?.settings && typeof row.settings === 'object' ? row.settings : {};
  const settings = { ...safeAccountSettings(current), ...incoming };
  if (current.__vault) settings.__vault = current.__vault;
  if (current.__debts) settings.__debts = current.__debts;
  await writeAccountSettingsRow(user.id, settings);
  return res.status(200).json({ ok: true, settings: safeAccountSettings(settings), source: 'supabase' });
}
async function handleAccountVault(req, res) {
  const user = await authenticatedSupabaseUser(req);
  if (!user?.id) return responseError(res, 401, 'Sesión de correo no válida o expirada');
  if (!YARBI_VAULT_KEY) return responseError(res, 503, 'La bóveda de credenciales aún no está configurada');
  res.setHeader('Cache-Control', 'no-store');
  const row = await readAccountSettingsRow(user.id);
  const currentSettings = row?.settings && typeof row.settings === 'object' ? row.settings : {};
  let currentSecrets = {};
  if (currentSettings.__vault) {
    try { currentSecrets = decryptVault(currentSettings.__vault, user.id); }
    catch (error) { return responseError(res, 500, 'No se pudo descifrar la bóveda de esta cuenta'); }
  }
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, configured: Boolean(currentSettings.__vault), secrets: currentSecrets, status: vaultStatus(currentSecrets), updatedAt: currentSettings.__vault?.updatedAt || null });
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const incoming = safeVaultSecrets(body.secrets);
  const secrets = { ...currentSecrets, ...incoming };
  if (Array.isArray(body.clearKeys)) body.clearKeys.forEach(key => { if (Object.prototype.hasOwnProperty.call(secrets, key)) secrets[key] = ''; });
  if (!Object.values(secrets).some(Boolean)) return responseError(res, 400, 'No hay credenciales para guardar');
  const settings = { ...safeAccountSettings(currentSettings), __vault: encryptVault(secrets, user.id) };
  if (currentSettings.__debts) settings.__debts = currentSettings.__debts;
  await writeAccountSettingsRow(user.id, settings);
  return res.status(200).json({ ok: true, configured: true, status: vaultStatus(secrets), updatedAt: settings.__vault.updatedAt, source: 'encrypted-vault' });
}

function safeConversationMessage(value, owner) {
  const role = value?.role === 'user' ? 'user' : value?.role === 'assistant' ? 'assistant' : '';
  const text = clean(value?.text, 8000);
  if (!role || !text) return null;
  const atNumber = Number(value?.at || value?.message_at || Date.now());
  const messageAt = new Date(Number.isFinite(atNumber) ? atNumber : Date.now());
  if (!Number.isFinite(messageAt.getTime())) return null;
  return {
    owner_key: owner,
    id: clean(value?.id, 120) || crypto.randomUUID(),
    role,
    text,
    channel: clean(value?.channel || 'chat', 30),
    message_at: messageAt.toISOString()
  };
}
async function handleConversation(req, res, owner) {
  if (req.method === 'GET') {
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit) || 300));
    const result = await supabase('/rest/v1/yarbi_conversation_messages?owner_key=eq.' + encodeURIComponent(owner) + '&select=id,role,text,channel,message_at&order=message_at.desc&limit=' + limit);
    if (!result.response.ok) return responseError(res, 502, result.data?.message || 'No se pudo leer el historial');
    const rows = Array.isArray(result.data) ? result.data.slice().reverse() : [];
    return res.status(200).json({
      ok: true,
      source: 'supabase',
      messages: rows.map(row => ({ id: row.id, role: row.role, text: row.text, channel: row.channel, at: Date.parse(row.message_at) }))
    });
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const source = Array.isArray(body.messages) ? body.messages : [];
  const messages = source.slice(0, 100).map(value => safeConversationMessage(value, owner)).filter(Boolean);
  if (!messages.length) return responseError(res, 400, 'No hay mensajes válidos');
  const result = await supabase('/rest/v1/yarbi_conversation_messages?on_conflict=owner_key,id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(messages)
  });
  if (!result.response.ok) return responseError(res, 502, result.data?.message || 'No se pudo guardar el historial');
  return res.status(200).json({ ok: true, source: 'supabase', saved: messages.length });
}

function safeTrainingExample(value) {
  const source = value && typeof value === 'object' ? value : {};
  const learning = source.learning && typeof source.learning === 'object' ? source.learning : {};
  const id = clean(source.id, 120) || crypto.randomUUID();
  const clientMessage = clean(source.client || source.client_message, 1000);
  const approvedResponse = clean(source.response || source.approved_response, 1600);
  const rule = clean(learning.rule || source.learning_rule || source.rule, 1000);
  if (!clientMessage || !approvedResponse || !rule) return null;
  const at = Number(source.at || source.created_at || Date.now());
  const updatedAt = Number(source.updatedAt || source.updated_at || Date.now());
  return {
    id,
    client_message: clientMessage,
    original_response: clean(source.originalResponse || source.original_response || approvedResponse, 1600),
    approved_response: approvedResponse,
    correction: clean(source.correction, 1200),
    learning_kind: clean(learning.kind || source.learning_kind || 'example', 40),
    learning_name: clean(learning.name || source.learning_name || 'Aprendizaje aprobado', 80),
    learning_rule: rule,
    intent: clean(learning.intent || source.intent || 'consulta_general', 60),
    service: clean(learning.service || source.service || 'general', 60),
    scope: clean(learning.scope || source.scope || 'whatsapp', 40),
    active: source.active !== false,
    tested: source.tested === true,
    test_passed: source.testPassed === true ? true : (source.testPassed === false ? false : null),
    test_message: clean(source.testMessage || source.test_message, 1000),
    test_response: clean(source.testResponse || source.test_response, 1600),
    usage_count: Math.max(0, Math.min(1000000, Number(source.usageCount || source.usage_count || 0) || 0)),
    last_used_at: source.lastUsedAt || source.last_used_at ? new Date(source.lastUsedAt || source.last_used_at).toISOString() : null,
    version: Math.max(1, Math.min(100000, Number(source.version || 1) || 1)),
    created_at: Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString(),
    updated_at: Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : new Date().toISOString(),
    deleted_at: null
  };
}

function trainingExampleForClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    client: row.client_message,
    originalResponse: row.original_response,
    response: row.approved_response,
    correction: row.correction || '',
    learning: {
      kind: row.learning_kind || 'example',
      name: row.learning_name || 'Aprendizaje aprobado',
      rule: row.learning_rule,
      intent: row.intent || 'consulta_general',
      service: row.service || 'general',
      scope: row.scope || 'whatsapp'
    },
    active: row.active !== false,
    cloudStatus: 'synced',
    instructionStatus: 'synced',
    tested: row.tested === true,
    testPassed: row.test_passed,
    testMessage: row.test_message || '',
    testResponse: row.test_response || '',
    usageCount: Number(row.usage_count || 0),
    lastUsedAt: row.last_used_at ? Date.parse(row.last_used_at) : null,
    at: row.created_at ? Date.parse(row.created_at) : Date.now(),
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
    version: Number(row.version || 1)
  };
}

async function handleTraining(req, res, owner) {
  if (req.method === 'GET') {
    const id = clean(req.query?.id, 120);
    const filter = id ? '&id=eq.' + encodeURIComponent(id) : '';
    const result = await supabase('/rest/v1/yarbi_training_examples?owner_key=eq.' + encodeURIComponent(owner) + filter + '&deleted_at=is.null&select=*&order=updated_at.desc&limit=100');
    if (!result.response.ok) return responseError(res, 502, result.data?.message || 'No se pudieron leer los aprendizajes');
    const rows = Array.isArray(result.data) ? result.data : [];
    return res.status(200).json({ ok: true, source: 'supabase', examples: rows.map(trainingExampleForClient).filter(Boolean) });
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (body.confirm !== true) return responseError(res, 400, 'Se requiere confirmación explícita');
  const operation = clean(body.operation || 'upsert', 30).toLowerCase();
  if (operation === 'delete') {
    const id = clean(body.id, 120);
    if (!id) return responseError(res, 400, 'Falta identificar el aprendizaje');
    const patch = await supabase('/rest/v1/yarbi_training_examples?owner_key=eq.' + encodeURIComponent(owner) + '&id=eq.' + encodeURIComponent(id) + '&deleted_at=is.null', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ active: false, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    });
    if (!patch.response.ok) return responseError(res, 502, patch.data?.message || 'No se pudo eliminar el aprendizaje');
    const rows = Array.isArray(patch.data) ? patch.data : [];
    if (!rows.length) return responseError(res, 404, 'No encontré el aprendizaje');
    return res.status(200).json({ ok: true, source: 'supabase', deleted: true, id });
  }
  if (operation !== 'upsert') return responseError(res, 400, 'Operación de aprendizaje no permitida');
  const example = safeTrainingExample(body.example);
  if (!example) return responseError(res, 400, 'El aprendizaje está incompleto');
  const result = await supabase('/rest/v1/yarbi_training_examples?on_conflict=owner_key,id', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ ...example, owner_key: owner })
  });
  if (!result.response.ok) return responseError(res, 502, result.data?.message || 'No se pudo guardar el aprendizaje');
  const row = Array.isArray(result.data) ? result.data[0] : null;
  return res.status(200).json({ ok: true, source: 'supabase', example: trainingExampleForClient(row) });
}

function auditLabel(value) {
  const candidate = clean(value, 80).toUpperCase().replace(/[^A-Z0-9_-]/g, '_').replace(/_+/g, '_');
  return candidate || ('AUDIT_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
}
function auditDateTomorrowLima() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const tomorrow = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 1));
  return tomorrow.toISOString().slice(0, 10);
}
async function auditEvent(runId, step, status, details = {}) {
  const result = await supabase('/rest/v1/yarbi_audit_events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: runId, step, status, details }) });
  return result.response.ok;
}
async function auditRunById(owner, runId) {
  const result = await supabase('/rest/v1/yarbi_audit_runs?owner_key=eq.' + encodeURIComponent(owner) + '&id=eq.' + encodeURIComponent(runId) + '&select=*&limit=1');
  if (!result.response.ok) throw new Error('No se pudo leer la ejecución de auditoría');
  return Array.isArray(result.data) ? result.data[0] : null;
}
function auditRunSummary(row) {
  if (!row) return null;
  return { id: row.id, label: row.label, status: row.status, audit_test: row.audit_test === true, client_id: row.client_id || null, agenda_event_id: row.agenda_event_id || null, created_at: row.created_at || null, completed_at: row.completed_at || null, cleaned_at: row.cleaned_at || null, result: row.result || {} };
}
async function handleAudit(req, res, owner) {
  if (!AUDIT_TEST_ENABLED) return responseError(res, 403, 'Canal de auditoría desactivado: AUDIT_TEST no está habilitado');
  if (req.method === 'GET') {
    const runId = clean(req.query?.run_id, 80);
    const filter = runId ? '&id=eq.' + encodeURIComponent(runId) : '';
    const runs = await supabase('/rest/v1/yarbi_audit_runs?owner_key=eq.' + encodeURIComponent(owner) + filter + '&select=*&order=created_at.desc&limit=25');
    if (!runs.response.ok) return responseError(res, 424, 'La tabla de auditoría no está disponible todavía');
    const rows = Array.isArray(runs.data) ? runs.data : [];
    const ids = rows.map(row => row.id).filter(Boolean);
    let events = [];
    if (ids.length) {
      const eventResult = await supabase('/rest/v1/yarbi_audit_events?run_id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=run_id,step,status,details,created_at&order=created_at.asc');
      if (eventResult.response.ok) events = Array.isArray(eventResult.data) ? eventResult.data : [];
    }
    return res.status(200).json({ ok: true, enabled: true, runs: rows.map(auditRunSummary), events });
  }
  const body = typeof req.body === 'object' ? req.body : {};
  if (body.audit_test !== true || body.confirm !== true) return responseError(res, 400, 'Se requiere audit_test=true y confirmación explícita');
  const operation = clean(body.operation || '', 40).toLowerCase();
  if (!['run_persistence', 'verify', 'cleanup'].includes(operation)) return responseError(res, 400, 'Operación de auditoría no permitida');
  const runId = clean(body.run_id, 80);
  if (operation === 'verify') {
    if (!runId) return responseError(res, 400, 'Falta run_id');
    const run = await auditRunById(owner, runId);
    if (!run) return responseError(res, 404, 'No encontré esa ejecución de auditoría');
    const [client, agenda] = await Promise.all([
      run.client_id ? supabase('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(run.client_id)) + '&source=eq.audit&select=id,source&limit=1') : Promise.resolve({ data: [] }),
      run.agenda_event_id ? supabase('/rest/v1/agenda_events?id=eq.' + encodeURIComponent(String(run.agenda_event_id)) + '&source=eq.audit&select=id,source,status,starts_at&limit=1') : Promise.resolve({ data: [] })
    ]);
    const result = { client_exists: Boolean(client.data?.[0]), visit_exists: Boolean(agenda.data?.[0]), visit_status: agenda.data?.[0]?.status || null, starts_at: agenda.data?.[0]?.starts_at || null };
    await auditEvent(run.id, 'verify', result.client_exists && result.visit_exists ? 'passed' : 'failed', result);
    return res.status(200).json({ ok: true, run: auditRunSummary(run), verification: result });
  }
  if (operation === 'cleanup') {
    if (!runId) return responseError(res, 400, 'Falta run_id');
    const run = await auditRunById(owner, runId);
    if (!run) return responseError(res, 404, 'No encontré esa ejecución de auditoría');
    const deletions = { visit_deleted: false, client_deleted: false };
    if (run.agenda_event_id) deletions.visit_deleted = (await supabase('/rest/v1/agenda_events?id=eq.' + encodeURIComponent(String(run.agenda_event_id)) + '&source=eq.audit', { method: 'DELETE' })).response.ok;
    if (run.client_id) deletions.client_deleted = (await supabase('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(run.client_id)) + '&source=eq.audit', { method: 'DELETE' })).response.ok;
    const cleanStatus = deletions.visit_deleted || !run.agenda_event_id ? (deletions.client_deleted || !run.client_id ? 'cleaned' : 'cleanup_failed') : 'cleanup_failed';
    await supabase('/rest/v1/yarbi_audit_runs?id=eq.' + encodeURIComponent(run.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: cleanStatus, cleaned_at: new Date().toISOString() }) });
    await auditEvent(run.id, 'cleanup', cleanStatus === 'cleaned' ? 'passed' : 'failed', deletions);
    return res.status(cleanStatus === 'cleaned' ? 200 : 207).json({ ok: cleanStatus === 'cleaned', run_id: run.id, cleanup: deletions });
  }
  const label = auditLabel(body.label);
  if (!label.startsWith('AUDIT_')) return responseError(res, 400, 'La etiqueta debe comenzar con AUDIT_');
  const runResult = await supabase('/rest/v1/yarbi_audit_runs', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ owner_key: owner, label, audit_test: true, status: 'running' }) });
  const run = Array.isArray(runResult.data) ? runResult.data[0] : null;
  if (!runResult.response.ok || !run?.id) return responseError(res, 424, 'La tabla de auditoría no está disponible todavía');
  await auditEvent(run.id, 'run_started', 'passed', { audit_test: true });
  try {
    const clientResult = await supabase('/rest/v1/crm_contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ full_name: 'YARBI AUDIT ' + label, display_name: 'YARBI AUDIT ' + label, source: 'audit', notes: 'AUDIT_TEST=true; no es cliente real.' }) });
    const client = Array.isArray(clientResult.data) ? clientResult.data[0] : null;
    if (!clientResult.response.ok || !client?.id) throw new Error('No se pudo crear el cliente de auditoría');
    await auditEvent(run.id, 'client_created', 'passed', { client_id: client.id });
    const clientRead = await supabase('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(client.id)) + '&source=eq.audit&select=id,source&limit=1');
    if (!clientRead.response.ok || !clientRead.data?.[0]?.id) throw new Error('No se pudo comprobar el cliente de auditoría');
    await auditEvent(run.id, 'client_readback', 'passed', { client_id: client.id });
    const tomorrow = auditDateTomorrowLima();
    const visitResult = await supabase('/rest/v1/agenda_events', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ contact_id: client.id, event_type: 'visita', title: 'YARBI AUDIT VISIT ' + label, service: 'AUDIT_TEST', description: 'AUDIT_TEST=true; visita temporal de trazabilidad.', starts_at: tomorrow + 'T09:00:00-05:00', timezone: 'America/Lima', status: 'pending', source: 'audit', dedupe_key: 'audit:' + run.id }) });
    const visit = Array.isArray(visitResult.data) ? visitResult.data[0] : null;
    if (!visitResult.response.ok || !visit?.id) throw new Error('No se pudo crear la visita de auditoría');
    await auditEvent(run.id, 'visit_created', 'passed', { agenda_event_id: visit.id, starts_at: visit.starts_at });
    const visitRead = await supabase('/rest/v1/agenda_events?id=eq.' + encodeURIComponent(String(visit.id)) + '&source=eq.audit&select=id,source,status,starts_at&limit=1');
    if (!visitRead.response.ok || !visitRead.data?.[0]?.id) throw new Error('No se pudo comprobar la visita de auditoría');
    const result = { client_persisted: true, visit_persisted: true, visit_starts_at: visitRead.data[0].starts_at };
    await supabase('/rest/v1/yarbi_audit_runs?id=eq.' + encodeURIComponent(run.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed', client_id: client.id, agenda_event_id: visit.id, completed_at: new Date().toISOString(), result }) });
    await auditEvent(run.id, 'visit_readback', 'passed', result);
    return res.status(201).json({ ok: true, run: { id: run.id, label, status: 'completed' }, persistence: result });
  } catch (error) {
    const detail = String(error?.message || 'Fallo de auditoría').slice(0, 300);
    await supabase('/rest/v1/yarbi_audit_runs?id=eq.' + encodeURIComponent(run.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'failed', completed_at: new Date().toISOString(), result: { error: detail } }) });
    await auditEvent(run.id, 'run_failed', 'failed', { error: detail });
    return responseError(res, 424, 'La prueba de persistencia no se pudo completar');
  }
}

// AGENT_LEDGER_V1: comparte la función Preferences para respetar el límite de
// funciones del plan Hobby. El acceso sigue siendo exclusivo del backend.
const AGENT_ACTION_STATUSES = new Set(['proposed', 'confirmed', 'executing', 'executed', 'failed', 'cancelled']);
const AGENT_ACTION_MODULES = new Set(['transactions', 'notes', 'agenda', 'debts', 'inventory', 'whatsapp', 'crm', 'service']);
function agentJson(value, max = 12000) {
  const source = value && typeof value === 'object' ? value : {};
  try { const serialized = JSON.stringify(source); return serialized.length <= max ? source : { truncated:true, preview:serialized.slice(0, max) }; }
  catch (_) { return {}; }
}
function agentAction(body = {}) {
  const action_id = clean(body.action_id, 160);
  const module = clean(body.module, 48).toLowerCase();
  const action_type = clean(body.action_type, 100).toLowerCase();
  const status = clean(body.status, 32).toLowerCase();
  if (!action_id || !/^[a-z0-9_.:-]{6,160}$/i.test(action_id)) return { error:'action_id_invalid' };
  if (!AGENT_ACTION_MODULES.has(module)) return { error:'module_invalid' };
  if (!action_type) return { error:'action_type_invalid' };
  if (!AGENT_ACTION_STATUSES.has(status)) return { error:'status_invalid' };
  return { action_id, module, action_type, status, target_type:clean(body.target_type,80) || null, target_id:clean(body.target_id,180) || null, confirmation_required:body.confirmation_required !== false, request_payload:agentJson(body.request_payload), result_payload:agentJson(body.result_payload), error_message:clean(body.error_message,800) || null };
}
function agentHistory(existing, event, now) {
  const previous = Array.isArray(existing?.history) ? existing.history.slice(-24) : [];
  const step = { at:now, status:event.status, result:event.result_payload, error:event.error_message };
  const last = previous[previous.length - 1];
  if (last && last.status === step.status && JSON.stringify(last.result || {}) === JSON.stringify(step.result || {}) && String(last.error || '') === String(step.error || '')) return previous;
  return [...previous, step];
}
async function agentReadAction(actionId) {
  const result = await supabase('/rest/v1/yarbi_agent_actions?action_id=eq.' + encodeURIComponent(actionId) + '&select=*&limit=1');
  if (!result.response.ok) throw new Error('action_lookup_failed');
  return Array.isArray(result.data) ? result.data[0] || null : null;
}
async function agentSaveAction(event) {
  const existing = await agentReadAction(event.action_id);
  if (existing && (String(existing.module) !== event.module || String(existing.action_type) !== event.action_type)) { const error = new Error('action_id_conflict'); error.code = 'action_id_conflict'; throw error; }
  if (existing?.status === 'executed' && event.status === 'executed') return { action:existing, duplicate:true, idempotent:true };
  const now = new Date().toISOString();
  const record = { ...event, history:agentHistory(existing,event,now), updated_at:now, executed_at:event.status === 'executed' ? (existing?.executed_at || now) : (existing?.executed_at || null) };
  const result = await supabase(existing ? '/rest/v1/yarbi_agent_actions?action_id=eq.' + encodeURIComponent(event.action_id) : '/rest/v1/yarbi_agent_actions', {
    method:existing ? 'PATCH' : 'POST', headers:{ 'Content-Type':'application/json', Prefer:'return=representation' }, body:JSON.stringify(existing ? record : [record])
  });
  const action = Array.isArray(result.data) ? result.data[0] : null;
  if (!result.response.ok || !action?.action_id) throw new Error('action_save_failed');
  return { action, duplicate:false, idempotent:false };
}
function agentResolution(body = {}) {
  const value = body.resolution && typeof body.resolution === 'object' ? body.resolution : {};
  const identity_key = clean(value.identity_key,220); const status = clean(value.status,80);
  if (!identity_key || !status) return { error:'resolution_invalid' };
  const numeric = input => Number.isInteger(Number(input)) && Number(input) > 0 ? Number(input) : null;
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(clean(value,10)) ? clean(value,10) : null;
  return { identity_key, contact_id:numeric(value.contact_id), agenda_event_id:numeric(value.agenda_id || value.agenda_event_id), phone:clean(value.phone,30) || null, client_name:clean(value.client_name,240) || null, status, reason:clean(value.reason,500) || null, follow_up_at:date(value.follow_up_at), linked_service_id:clean(value.linked_service_id,160) || null, linked_service_date:date(value.linked_service_date), financial_mutation:value.financial_mutation === true, resolved_at:new Date(value.resolved_at || Date.now()).toISOString(), source:clean(value.source,80) || 'yarbi_app', updated_at:new Date().toISOString() };
}
async function agentSaveResolution(body) {
  const resolution = agentResolution(body);
  if (resolution.error) { const error = new Error(resolution.error); error.code = resolution.error; throw error; }
  const current = await supabase('/rest/v1/yarbi_client_resolutions?identity_key=eq.' + encodeURIComponent(resolution.identity_key) + '&select=resolved_at&limit=1');
  if (!current.response.ok) throw new Error('resolution_lookup_failed');
  const previous = Array.isArray(current.data) ? current.data[0] : null;
  if (previous?.resolved_at && Date.parse(previous.resolved_at) > Date.parse(resolution.resolved_at)) return { resolution:previous, stale:true };
  const result = await supabase('/rest/v1/yarbi_client_resolutions?identity_key=eq.' + encodeURIComponent(resolution.identity_key), { method:previous ? 'PATCH' : 'POST', headers:{ 'Content-Type':'application/json', Prefer:'return=representation' }, body:JSON.stringify(previous ? resolution : [resolution]) });
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!result.response.ok || !row?.identity_key) throw new Error('resolution_save_failed');
  return { resolution:row, stale:false };
}
async function handleAgentLedger(req, res) {
  if (req.method === 'GET') {
    const resource = clean(req.query?.resource,30).toLowerCase();
    const limit = Math.min(Math.max(Number(req.query?.limit || 30),1),100);
    const table = resource === 'audit' ? 'yarbi_agent_actions?select=action_id,module,action_type,status,target_type,target_id,confirmation_required,error_message,created_at,updated_at,executed_at&order=updated_at.desc&limit=' : resource === 'resolutions' ? 'yarbi_client_resolutions?select=*&order=updated_at.desc&limit=' : '';
    if (!table) return responseError(res,400,'resource_invalid');
    const result = await supabase('/rest/v1/' + table + limit);
    if (!result.response.ok) throw new Error(resource === 'audit' ? 'audit_read_failed' : 'resolution_read_failed');
    return res.status(200).json(resource === 'audit' ? { ok:true, audits:result.data || [] } : { ok:true, resolutions:result.data || [] });
  }
  const body = typeof req.body === 'object' ? req.body : {};
  if (body.operation === 'upsert_resolution') return res.status(200).json({ ok:true, ...(await agentSaveResolution(body)) });
  const event = agentAction(body);
  if (event.error) return responseError(res,400,event.error);
  const saved = await agentSaveAction(event);
  return res.status(200).json({ ok:true, audit:saved.action, duplicate:saved.duplicate, idempotent:saved.idempotent });
}
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const runtime = validateServerRouteConfig();
  if (!runtime.ok) return responseError(res, 503, 'configuration_invalid', runtime.code);
  SUPABASE_URL = runtime.supabaseUrl;
  SUPABASE_KEY = runtime.supabaseKey;
  const action = clean(req.query?.action || '', 40).toLowerCase();
  if (action === 'auth-callback' && req.method === 'GET') return authCallbackPage(res);
  if (action === 'auth-config' && req.method === 'GET') {
    return res.status(200).json({ ok: true, supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY });
  }
  if (action === 'account-settings') {
    if (!['GET', 'POST'].includes(req.method)) return responseError(res, 405, 'Método no permitido');
    try { return await handleAccountSettings(req, res); } catch (error) {
      console.error('[ACCOUNT SETTINGS ERROR]', error);
      return responseError(res, 502, 'No se pudieron sincronizar las configuraciones');
    }
  }
  if (action === 'account-vault') {
    if (!['GET', 'POST'].includes(req.method)) return responseError(res, 405, 'Método no permitido');
    try { return await handleAccountVault(req, res); } catch (error) {
      console.error('[ACCOUNT VAULT ERROR]', error);
      return responseError(res, 502, 'No se pudo acceder a la bóveda de credenciales');
    }
  }
  if (action === 'account-debts') {
    if (!['GET', 'POST'].includes(req.method)) return responseError(res, 405, 'Método no permitido');
    try { return await handleAccountDebts(req, res); } catch (error) {
      console.error('[ACCOUNT DEBTS ERROR]', error);
      return responseError(res, 502, 'No se pudieron sincronizar las deudas');
    }
  }
  if (!['GET', 'POST'].includes(req.method)) return responseError(res, 405, 'Método no permitido');
  if (!authorized(req)) return responseError(res, 401, 'No autorizado');
  const owner = ownerKey(req);
  if (action === 'agent') {
    try { return await handleAgentLedger(req, res); } catch (error) {
      console.error('[YARBI AGENT LEDGER]', error.code || error.message);
      return responseError(res, error.code === 'action_id_conflict' || error.code === 'resolution_invalid' ? 409 : 502, error.code || 'agent_ledger_failed');
    }
  }
  if (action === 'conversation') {
    try { return await handleConversation(req, res, owner); } catch (error) {
      console.error('[YARBI CONVERSATION ERROR]', error);
      return responseError(res, 500, 'No se pudo procesar el historial');
    }
  }
  if (action === 'training') {
    try { return await handleTraining(req, res, owner); } catch (error) {
      console.error('[YARBI TRAINING ERROR]', error);
      return responseError(res, 502, 'No se pudo sincronizar el aprendizaje');
    }
  }
  if (action === 'audit') {
    try { return await handleAudit(req, res, owner); } catch (error) {
      console.error('[YARBI AUDIT ERROR]', error);
      return responseError(res, 502, 'No se pudo completar la auditoría interna');
    }
  }

  if (req.method === 'GET') {
    const result = await supabase('/rest/v1/yarbi_instructions?owner_key=eq.' + owner + '&deleted_at=is.null&select=id,name,instruction,category,scope,active,created_at,updated_at&order=updated_at.desc&limit=50');
    if (!result.response.ok) return responseError(res, 502, result.data?.message || 'No se pudieron leer las instrucciones');
    return res.status(200).json({ ok: true, instructions: Array.isArray(result.data) ? result.data : [], source: 'supabase' });
  }

  const body = typeof req.body === 'object' ? req.body : {};
  if (body.confirm !== true) return responseError(res, 400, 'Se requiere confirmación explícita');
  const operation = clean(body.operation || body.action || 'upsert', 30).toLowerCase();
  const id = clean(body.id, 80);
  const instruction = clean(body.instruction, 2000);
  const name = clean(body.name || body.title, 120);

  if (operation === 'delete') {
    if (!id && !instruction) return responseError(res, 400, 'Falta el id o el texto exacto de la instrucción');
    const useId = /^[0-9a-f-]{36}$/i.test(id); const filters = useId ? 'id=eq.' + encodeURIComponent(id) : 'instruction=eq.' + encodeURIComponent(instruction);
    const patch = await supabase('/rest/v1/yarbi_instructions?owner_key=eq.' + owner + '&' + filters + '&deleted_at=is.null', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ active: false, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    });
    if (!patch.response.ok) return responseError(res, 502, patch.data?.message || 'No se pudo eliminar la instrucción');
    const rows = Array.isArray(patch.data) ? patch.data : [];
    if (!rows.length) return responseError(res, 404, 'No encontré una instrucción única para eliminar');
    await supabase('/rest/v1/yarbi_instruction_events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_key: owner, instruction_id: rows[0].id, action: 'delete', name: rows[0].name, instruction: rows[0].instruction }) });
    return res.status(200).json({ ok: true, deleted: true, instruction: { id: rows[0].id, name: rows[0].name } });
  }

  if (operation === 'set_active') {
    if (!id && !instruction) return responseError(res, 400, 'Falta identificar la instrucción');
    const useId = /^[0-9a-f-]{36}$/i.test(id); const filters = useId ? 'id=eq.' + encodeURIComponent(id) : 'instruction=eq.' + encodeURIComponent(instruction);
    const active = body.active !== false;
    const patch = await supabase('/rest/v1/yarbi_instructions?owner_key=eq.' + owner + '&' + filters + '&deleted_at=is.null', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ active, updated_at: new Date().toISOString() })
    });
    if (!patch.response.ok) return responseError(res, 502, patch.data?.message || 'No se pudo cambiar el estado');
    const rows = Array.isArray(patch.data) ? patch.data : [];
    if (!rows.length) return responseError(res, 404, 'No encontré la instrucción');
    await supabase('/rest/v1/yarbi_instruction_events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_key: owner, instruction_id: rows[0].id, action: active ? 'activate' : 'pause', name: rows[0].name, instruction: rows[0].instruction }) });
    return res.status(200).json({ ok: true, active });
  }

  if (instruction.length < 8) return responseError(res, 400, 'La instrucción es demasiado corta');
  const upsert = await supabase('/rest/v1/yarbi_instructions?on_conflict=owner_key,instruction', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ owner_key: owner, name: name || instruction.slice(0, 64), instruction, category: clean(body.category || 'behavior', 40), scope: clean(body.scope || 'all', 40), active: true, deleted_at: null, updated_at: new Date().toISOString() })
  });
  if (!upsert.response.ok) return responseError(res, 502, upsert.data?.message || 'No se pudo guardar la instrucción');
  const row = Array.isArray(upsert.data) ? upsert.data[0] : null;
  if (row?.id) await supabase('/rest/v1/yarbi_instruction_events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_key: owner, instruction_id: row.id, action: 'upsert', name: row.name, instruction: row.instruction }) });
  return res.status(200).json({ ok: true, instruction: row, source: 'supabase' });
};

