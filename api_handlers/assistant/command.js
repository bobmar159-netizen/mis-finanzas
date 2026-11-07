const { extractCoordinatesFromMapsUrl } = require('../../lib/location-resolver');
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');

let SUPABASE_URL = '';
let SUPABASE_KEY = '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.6-flash';

function cors(res) {
  if (process.env.APP_ORIGIN) res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function cleanPhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('51') && phone.length === 11) phone = phone.slice(2);
  return phone;
}

function phoneVariants(value) {
  const phone = cleanPhone(value);
  return phone ? Array.from(new Set([phone, '51' + phone])) : [];
}

async function supabase(endpoint, options = {}) {
  const response = await fetch(SUPABASE_URL + endpoint, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function legacyClient(row) {
  if (!row) return null;
  return { ...row, name: String(row.name || '').trim(), phone_number: cleanPhone(row.phone_number || ''), legacy_client_id: row.id || null, crm_contact_id: null, source: 'clients' };
}

function modernClient(row, phone) {
  if (!row) return null;
  const name = String(row.display_name || row.full_name || '').trim();
  return { id: row.id || null, name, phone_number: cleanPhone(phone || ''), address_summary: '', legacy_client_id: null, crm_contact_id: row.id || null, source: 'crm_contacts' };
}

async function findModernContactByPhone(phone) {
  if (!SUPABASE_KEY || !phone) return null;
  for (const variant of phoneVariants(phone)) {
    const identifier = await supabase('/rest/v1/contact_identifiers?identifier_type=eq.phone&normalized_value=eq.' + encodeURIComponent(variant) + '&select=contact_id&limit=1');
    const contactId = identifier.response.ok ? identifier.data?.[0]?.contact_id : null;
    if (!contactId) continue;
    const contact = await supabase('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(contactId)) + '&select=id,full_name,display_name&limit=1');
    if (contact.response.ok && contact.data?.[0]) return modernClient(contact.data[0], variant);
  }
  return null;
}

async function findClient(phone) {
  if (!SUPABASE_KEY || !phone) return null;
  const modern = await findModernContactByPhone(phone);
  if (modern) return modern;
  for (const variant of phoneVariants(phone)) {
    const result = await supabase('/rest/v1/clients?phone_number=eq.' + encodeURIComponent(variant) + '&select=*&limit=1');
    if (result.response.ok && result.data?.[0]) return legacyClient(result.data[0]);
  }
  return null;
}

async function findModernContactsByName(name) {
  const value = String(name || '').trim();
  if (!SUPABASE_KEY || value.length < 3) return [];
  const pattern = encodeURIComponent('*' + value + '*');
  const contacts = await supabase('/rest/v1/crm_contacts?or=(display_name.ilike.' + pattern + ',full_name.ilike.' + pattern + ')&select=id,full_name,display_name&limit=8');
  if (!contacts.response.ok || !Array.isArray(contacts.data) || !contacts.data.length) return [];
  const ids = contacts.data.map(row => Number(row.id)).filter(Number.isFinite);
  const identifiers = ids.length
    ? await supabase('/rest/v1/contact_identifiers?identifier_type=eq.phone&contact_id=in.(' + ids.join(',') + ')&select=contact_id,normalized_value,is_primary&order=is_primary.desc')
    : { response: { ok: true }, data: [] };
  const phoneByContact = new Map();
  if (identifiers.response.ok && Array.isArray(identifiers.data)) identifiers.data.forEach(row => { if (!phoneByContact.has(String(row.contact_id))) phoneByContact.set(String(row.contact_id), cleanPhone(row.normalized_value)); });
  return contacts.data.map(row => modernClient(row, phoneByContact.get(String(row.id)) || '')).filter(Boolean);
}

async function findClientsByName(name) {
  if (!SUPABASE_KEY || String(name || '').trim().length < 3) return [];
  const [modern, legacyResult] = await Promise.all([
    findModernContactsByName(name),
    supabase('/rest/v1/clients?name=ilike.' + encodeURIComponent('*' + String(name).trim() + '*') + '&select=id,name,phone_number,address_summary&limit=8')
  ]);
  const unique = new Map();
  [...modern, ...((legacyResult.response.ok && Array.isArray(legacyResult.data)) ? legacyResult.data.map(legacyClient) : [])].forEach(row => {
    const key = cleanPhone(row?.phone_number) || ('name:' + String(row?.name || '').toLocaleLowerCase());
    if (row && !unique.has(key)) unique.set(key, row);
  });
  return Array.from(unique.values()).slice(0, 8);
}

function compactAlert(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: String(value.id || ''),
    clientName: String(value.clientName || value.name || value.title || '').slice(0, 160),
    phone: cleanPhone(value.phone || ''),
    text: String(value.text || '').slice(-4000),
    mapsUrl: String(value.mapsUrl || value.maps_url || '').trim(),
    coordinates: value.coordinates || value.coordenadas || null,
    timestamp: Number(value.timestamp || 0) || null
  };
}

// Contexto confirmado por la propia app. Solo se usa cuando la app marcó el
// foco como vigente; no sustituye la validación de teléfono antes de escribir.
function compactConversationFocus(value) {
  if (!value || typeof value !== 'object' || value.confirmed !== true) return null;
  const phone = cleanPhone(value.phone || '');
  const clientName = String(value.client_name || value.clientName || value.name || '').trim().slice(0, 160);
  const agendaId = String(value.agenda_id || value.agendaId || '').trim().slice(0, 160);
  if (!phone && !clientName && !agendaId) return null;
  return {
    contactId: String(value.contact_id || value.contactId || '').trim().slice(0, 160),
    clientName,
    phone,
    agendaId,
    agendaKind: String(value.agenda_kind || value.agendaKind || '').trim().slice(0, 40),
    agendaStatus: String(value.agenda_status || value.agendaStatus || '').trim().slice(0, 80),
    appointmentDate: String(value.appointment_date || value.appointmentDate || '').trim().slice(0, 20),
    appointmentTime: String(value.appointment_time || value.appointmentTime || '').trim().slice(0, 20)
  };
}

function compactPendingDraft(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    tipo: String(value.tipo || '').slice(0, 40),
    editId: String(value.editId || '').slice(0, 160),
    clientName: String(value.clientName || '').slice(0, 160),
    phone: cleanPhone(value.phone || ''),
    date: String(value.date || '').slice(0, 20),
    time: String(value.time || '').slice(0, 20),
    service: String(value.service || '').slice(0, 300),
    location: String(value.location || '').slice(0, 500),
    mapsUrl: String(value.mapsUrl || '').trim().slice(0, 1200),
    price: Number(value.price) || null,
    missing: Array.isArray(value.missing) ? value.missing.map(item => String(item).slice(0, 80)).slice(0, 12) : []
  };
}

function phoneFromText(value) {
  const match = String(value || '').match(/(?:\+?51[\s.-]*)?(9\d{2}[\s.-]?\d{3}[\s.-]?\d{3})/);
  return cleanPhone(match ? match[0] : '');
}

function isMapsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'maps.google.com' || host.startsWith('maps.google.') || /(^|\.)google\.[a-z.]+$/.test(host);
  } catch (_) { return false; }
}

function explicitPriceFromMessages(messages) {
  for (const message of (messages || []).slice().reverse()) {
    const text = String(message?.text || message?.content || '').replace(/\s+/g, ' ');
    const match = text.match(/\b(?:precio|total|presupuesto|costo|valor)\b[^0-9]{0,24}(?:s\/?\.?\s*|soles?\s*)?([0-9][0-9.,]*)/i);
    if (!match) continue;
    const raw = String(match[1] || '').replace(/,/g, '');
    const amount = Number(raw);
    if (Number.isFinite(amount) && amount > 0 && amount <= 1000000) return amount;
  }
  return 0;
}

function phoneIsTrusted(candidate, lockedPhone, text) {
  const value = cleanPhone(candidate);
  if (!value) return false;
  const locked = cleanPhone(lockedPhone);
  const explicit = cleanPhone(phoneFromText(text));
  return Boolean((locked && value === locked) || (explicit && value === explicit));
}

function publicCandidates(clients) {
  return clients.map((client) => ({ id: client.id || '', name: client.name || 'Cliente sin nombre', phone: cleanPhone(client.phone_number || ''), address: client.address_summary || '' }));
}

function ambiguityResponse(name, clients) {
  const matches = publicCandidates(clients);
  return {
    reply: 'Encontré ' + matches.length + ' coincidencias para ' + name + '. Dime un detalle fácil de reconocer —distrito, servicio, ubicación o fecha aproximada— y elijo la correcta. Los últimos dígitos del teléfono son solo el último recurso.',
    action: { intent: 'disambiguate_client', client_name: name, candidates: matches, requires_consent: false },
    draft: null,
    requiresConsent: false,
    requiresDisambiguation: true,
    matches,
    model: GEMINI_MODEL
  };
}

async function loadMessages(phone) {
  if (!SUPABASE_KEY || !phone) return [];
  const rows = [];
  for (const variant of phoneVariants(phone)) {
    const result = await supabase('/rest/v1/whatsapp_messages?deleted_at=is.null&phone=eq.' + encodeURIComponent(variant) + '&select=*&order=timestamp.desc&limit=30');
    if (result.response.ok && Array.isArray(result.data)) rows.push(...result.data);
  }
  const unique = new Map(rows.map((row) => [row.id || (row.timestamp + '|' + row.text), row]));
  return Array.from(unique.values()).sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)).slice(-30);
}

function geminiDetail(data) {
  return String(data?.error?.message || data?.error?.status || 'Gemini request failed').slice(0, 300);
}

function limaParts(value) {
  const numeric = Number(value);
  const input = value ? (Number.isFinite(numeric) && numeric < 100000000000 ? numeric * 1000 : value) : Date.now();
  const sourceDate = new Date(input);
  const safeDate = Number.isNaN(sourceDate.getTime()) ? new Date() : sourceDate;
  // Peru does not observe DST: UTC-05:00 is stable and avoids server UTC leakage.
  const lima = new Date(safeDate.getTime() - (5 * 60 * 60 * 1000));
  const pad = (number) => String(number).padStart(2, '0');
  return {
    date: lima.getUTCFullYear() + '-' + pad(lima.getUTCMonth() + 1) + '-' + pad(lima.getUTCDate()),
    time: pad(lima.getUTCHours()) + ':' + pad(lima.getUTCMinutes())
  };
}

function normalizedOrderText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Calendar arithmetic deliberately uses a noon UTC date that represents the
// Lima calendar day. It must never use the server's local timezone nor copy a
// date from an older CRM record.
function agendaDateFromOrderLima(text, limaDate) {
  const value = normalizedOrderText(text);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(limaDate || ''))) return '';
  const base = new Date(String(limaDate) + 'T12:00:00Z');
  const move = (days) => { const copy = new Date(base.getTime()); copy.setUTCDate(copy.getUTCDate() + days); return copy.toISOString().slice(0, 10); };
  if (/\bpasado manana\b/.test(value)) return move(2);
  if (/\bmanana\b/.test(value) && !/\b(?:en|por|de|a)\s+la\s+manana\b/.test(value)) return move(1);
  if (/\bhoy\b/.test(value)) return move(0);
  const weekdays = { domingo:0, lunes:1, martes:2, miercoles:3, jueves:4, viernes:5, sabado:6 };
  const match = value.match(/\b(?:este|esta|el|la|proximo|proxima|siguiente)?\s*(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
  if (!match) return '';
  let days = (weekdays[match[1]] - base.getUTCDay() + 7) % 7;
  if (/\b(?:proximo|proxima|siguiente)\b/.test(match[0]) && days === 0) days = 7;
  return move(days);
}

function agendaTimeFromOrder(text) {
  const value = normalizedOrderText(text);
  const words = { una:1, uno:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10, once:11, doce:12 };
  const match = value.match(/\b(?:a\s+las?\s*)?(\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:[:.]([0-5]\d)|\s+y\s+(media|cuarto))?\s*(?:de\s+la\s+)?(manana|tarde|noche|am|pm)\b/);
  if (!match) return '';
  let hour = /^\d+$/.test(match[1]) ? Number(match[1]) : words[match[1]];
  const minute = match[3] === 'media' ? 30 : (match[3] === 'cuarto' ? 15 : Number(match[2] || 0));
  if ((match[4] === 'tarde' || match[4] === 'noche' || match[4] === 'pm') && hour < 12) hour += 12;
  if ((match[4] === 'manana' || match[4] === 'am') && hour === 12) hour = 0;
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') : '';
}

function agendaServiceFromOrder(text) {
  const match = String(text || '').match(/\b((?:con(?:ex|ecc)i[oó]n|instalaci[oó]n|modificaci[oó]n|reparaci[oó]n|punto|gasfiter[ií]a|servicio|trabajo)[\s\S]*)$/i);
  return String(match?.[1] || '').replace(/[.!,;]+$/, '').trim().slice(0, 300);
}

function isManualNewAgendaOrder(text) {
  const value = normalizedOrderText(text);
  const wantsSave = /\b(?:agenda|agendar|programa|programar|guarda|guardar|guarde|registra|registrar|anota|anotar)\b/.test(value);
  const agendaThing = /\b(?:cliente|visita|construccion|trabajo|con(?:ex|ecc)ion|instalacion|modificacion|reparacion|punto|gasfiteria)\b/.test(value);
  return wantsSave && agendaThing && /\b(?:un|una)\s+cliente\b/.test(value);
}

function messageTimestamp(message) {
  return message?.timestamp || message?.created_at || 0;
}

function isGenericTodayQuestion(text) {
  const value = String(text || '').toLowerCase();
  return /\b(hoy|ayer)\b/.test(value) && /(mensaje|whatsapp|cliente|escribi[oó]|contact[oó]|alerta)/.test(value);
}

function isCurrentDateQuestion(text) {
  const value = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[¿?¡!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 90) return false;
  return /^(?:yarbi\s+)?(?:(?:dime|indica(?:me)?|confirma(?:me)?|quiero saber)\s+)?(?:que|cual)\s+(?:fecha|dia)\s+(?:es|tienes|tenemos)(?:\s+(?:hoy|actualmente))?$/.test(value)
    || /^(?:yarbi\s+)?(?:(?:dime|indica(?:me)?|confirma(?:me)?)\s+)?(?:la\s+)?fecha(?:\s+actual|\s+de\s+hoy)?$/.test(value)
    || /^(?:yarbi\s+)?(?:hoy\s+)?que\s+dia\s+es$/.test(value);
}

// Una conversación natural suele continuar con una fecha u hora corta:
// "para el martes", "ponlo a las 4" o "mejor mañana". Cuando la app ya
// confirmó una agenda concreta, esto no debe volver a abrir una búsqueda de
// cliente ni convertir el turno en una respuesta general. La condición exige
// un ancla temporal con una fórmula de programación para no mutar la agenda
// por preguntas informativas como "¿qué día es mañana?".
function isFocusedAgendaContinuation(text) {
  const value = String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[¿?¡!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 180) return false;
  const day = '(?:hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|\\d{1,2}(?:[/-]\\d{1,2})?(?:[/-]\\d{2,4})?)';
  const temporalContinuation = new RegExp('(?:\\bpara\\s+(?:el\\s+)?' + day + '\\b|\\b(?:el|desde)\\s+' + day + '\\b|\\ba\\s+las?\\s+\\d{1,2}(?::\\d{2})?\\b)');
  const scheduleVerb = /\b(?:pon(?:lo|la)?|dej(?:alo|ala)?|muev(?:elo|ela)?|cambi(?:alo|ala)?|reprogram(?:alo|ala)?|program(?:alo|ala)?|agend(?:alo|ala)?)\b/;
  return temporalContinuation.test(value) && (scheduleVerb.test(value) || /\bpara\s+(?:el\s+)?(?:hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(value));
}

async function loadMessagesForLimaDate(dateKey) {
  if (!SUPABASE_KEY) return [];
  const result = await supabase('/rest/v1/whatsapp_messages?deleted_at=is.null&select=id,title,phone,text,maps_url,timestamp,app_name&order=timestamp.desc&limit=200');
  if (!result.response.ok || !Array.isArray(result.data)) return [];
  const dated = result.data.filter((message) => limaParts(messageTimestamp(message)).date === dateKey);
  const cloud = dated.filter((message) => /cloud|meta/i.test(String(message.app_name || '')));
  return (cloud.length ? cloud : dated).slice(0, 12);
}

function localMessagesForLimaDate(values, dateKey) {
  if (!Array.isArray(values)) return [];
  return values.slice(-80).map((value) => ({
    title: String(value?.name || value?.title || value?.phone || 'Cliente sin nombre').slice(0, 160),
    phone: cleanPhone(value?.phone || ''),
    text: String(value?.text || '').slice(0, 1000),
    timestamp: Number(value?.timestamp || 0) || 0,
    app_name: 'Android local notification history'
  })).filter((value) => value.text && value.timestamp && limaParts(value.timestamp).date === dateKey);
}

function mergeMessageLists(primary, secondary) {
  const unique = new Map();
  [...(primary || []), ...(secondary || [])].forEach((message) => {
    const key = cleanPhone(message.phone || '') + '|' + Number(message.timestamp || 0) + '|' + String(message.text || '');
    if (!unique.has(key)) unique.set(key, message);
  });
  return Array.from(unique.values()).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, 40);
}
function todayReply(messages, dateKey) {
  if (!messages.length) return 'No encontré mensajes de WhatsApp con fecha ' + dateKey + ' en la base de datos.';
  const list = messages.slice(0, 5).map((message) => {
    const at = limaParts(messageTimestamp(message));
    const name = message.title || cleanPhone(message.phone) || 'Cliente sin nombre';
    const preview = String(message.text || 'Mensaje recibido').replace(/\s+/g, ' ').slice(0, 90);
    return name + ' a las ' + at.time + ': ' + preview;
  });
  return 'Hoy, ' + dateKey + ', encontré ' + messages.length + ' mensaje(s). ' + list.join(' | ');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const runtime = validateServerRouteConfig({ requirePublicAuth: true });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  const identity = await authenticatedOwnerIdentity(req, runtime);
  if (!identity.ok) return res.status(identity.status).json({ error: identity.code });
  SUPABASE_URL = runtime.supabaseUrl;
  SUPABASE_KEY = runtime.supabaseKey;
  if (!GEMINI_KEY) return res.status(503).json({ error: 'assistant_not_configured' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const text = String(body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text_required' });
    const nowLima = limaParts();
    if (isCurrentDateQuestion(text)) {
      return res.status(200).json({ reply: 'Hoy en Lima es ' + nowLima.date + ' y son las ' + nowLima.time + '.', action: { intent: 'read_current_datetime', date: nowLima.date, time: nowLima.time }, draft: null, requiresConsent: false, requiresDisambiguation: false, model: GEMINI_MODEL });
    }
    if (isGenericTodayQuestion(text)) {
      const wantsYesterday = /\bayer\b/i.test(text);
      const ref = new Date();
      if (wantsYesterday) ref.setDate(ref.getDate() - 1);
      const requestedDate = limaParts(ref).date;
      const cloudMessages = await loadMessagesForLimaDate(requestedDate);
      const deviceMessages = localMessagesForLimaDate(body.localMessages, requestedDate);
      const todayMessages = mergeMessageLists(deviceMessages, cloudMessages);
      return res.status(200).json({ reply: todayReply(todayMessages, requestedDate), action: { intent: 'read_today_messages', date: requestedDate, count: todayMessages.length, sources: { device: deviceMessages.length, cloud: cloudMessages.length } }, draft: null, requiresConsent: false, requiresDisambiguation: false, model: GEMINI_MODEL });
    }

    const activeAlert = compactAlert(body.activeAlert);
    const conversationFocus = compactConversationFocus(body.conversationFocus);
    const pendingDraft = compactPendingDraft(body.pendingDraft);
    // “Guarda un cliente…” es una alta manual. Nunca se puede convertir en la
    // última alerta/foco de WhatsApp, porque una llamada o un contacto nuevo no
    // tiene por qué existir en Business.
    const manualNewAgenda = isManualNewAgendaOrder(text);
    // El foco confirmado prevalece sobre una alerta vieja en pantalla. Esto
    // permite órdenes naturales como “reprográmalo” sin volver a pedir cliente.
    const requestedName = manualNewAgenda ? '' : String(body.clientName || conversationFocus?.clientName || activeAlert?.clientName || pendingDraft?.clientName || '').trim();
    const phone = cleanPhone(manualNewAgenda ? phoneFromText(text) : (body.phone || conversationFocus?.phone || activeAlert?.phone || pendingDraft?.phone || phoneFromText(text)));
    let client = await findClient(phone);
    let candidates = !client && !phone && requestedName ? await findClientsByName(requestedName) : [];
    if (candidates.length > 1) return res.status(200).json(ambiguityResponse(requestedName, candidates));
    if (!client && candidates.length === 1) client = candidates[0];
    let messages = await loadMessages(phone || client?.phone_number);
    const history = messages
      .map((message) => { const at = limaParts(messageTimestamp(message)); return '[' + at.date + ' ' + at.time + ' Lima] [' + (message.title || 'Cliente') + '] ' + (message.text || ''); })
      .join('\n')
      .slice(-24000);
    const agenda = Array.isArray(body.agenda) ? body.agenda.slice(0, 80) : [];
    const appContext = activeAlert ? JSON.stringify(activeAlert).slice(0, 7000) : '[sin alerta activa]';
    const focusContext = conversationFocus ? JSON.stringify(conversationFocus).slice(0, 3000) : '[sin foco conversacional confirmado]';
    const formContext = pendingDraft ? JSON.stringify(pendingDraft).slice(0, 5000) : '[sin formulario abierto]';
    const liveMemory = String(body.liveMemory || '').slice(-16000);

    const prompt = [
      'Eres Yarbi, asistente operativo de finanzas y CRM de instalaciones de gas natural en Lima.',
      'Analiza la orden del Maestro y devuelve solo JSON valido.',
      'FECHA Y HORA ACTUAL EN LIMA: ' + nowLima.date + ' ' + nowLima.time + '.',
      'Cada mensaje del historial incluye fecha y hora de Lima. Si el Maestro pregunta por hoy, ayer o el último mensaje, usa solo la fecha solicitada y nunca presentes un mensaje antiguo como actual.',
      'No inventes clientes, fechas, teléfonos, coordenadas ni ubicaciones.',
      'El FOCO CONVERSACIONAL CONFIRMADO corresponde al cliente de los pronombres y seguimientos inmediatos: él, ella, ese cliente, reprográmalo, edítalo, elimínalo o mándaselo. Úsalo antes que una ALERTA ACTIVA antigua. Si hay más de una coincidencia por nombre y no hay foco, usa intent disambiguate_client y pide una pista natural; jamás elijas al azar.',
      'Para crear una visita, construcción o seguimiento, extrae fecha y hora únicamente de la ORDEN y de la ALERTA ACTIVA. El HISTORIAL antiguo sirve como apoyo, pero nunca copies de allí una fecha u hora si no aparece en la conversación activa.',
      'Completa todos los datos disponibles y comprobables: nombre y teléfono del CLIENTE o ALERTA ACTIVA, enlace Maps, ubicación, servicio y precio acordado. El enlace Maps puede conservarse aunque no revele coordenadas; nunca inventes una dirección.',
      'El teléfono del foco confirmado o de la alerta activa identifica al cliente. Nunca uses un teléfono de otro mensaje, otro cliente o una coincidencia aproximada. Si el dato no está confirmado, devuelve phone vacío y pide confirmación.',
      'Para servicios múltiples usa service como principal y service_details como lista. Extrae price solo cuando el Maestro o el historial lo indiquen expresamente como precio, total, presupuesto, costo o valor. No afirmes que una acción se guardó: la app confirma el resultado real.',
      'Si hay FORMULARIO ABIERTO, interpreta la orden como edición de ese mismo registro: usa intent update_agenda, conserva su editId como agenda_id y no crees otra agenda. Si el Maestro dice que el cliente acaba de enviar ubicación, toma el enlace Maps más reciente del HISTORIAL y colócalo solo en maps_url; no lo copies a description ni a notas.',
      'REGLA DE ESTADOS: tipo y estado son cosas distintas. create_visit crea una visita futura; create_construction crea una construcción futura; create_followup crea seguimiento. Ninguna de esas órdenes significa servicio finalizado. Reprogramado significa que sigue abierto con nueva fecha. Finalizado solo procede cuando el Maestro afirma expresamente que el trabajo ya se realizó o terminó. Desistió/canceló es distinto de finalizado.',
      'intent puede ser read_latest_message, read_client, read_agenda, read_finances, read_inventory, read_notes, create_visit, create_construction, create_followup, update_agenda, delete_agenda, register_service, create_expense, create_income, create_note, send_whatsapp, open_location o general. Usa register_service exclusivamente cuando el Maestro diga registrar, cerrar o cobrar un servicio ya realizado; nunca lo uses para frases como agendar construcción. Para cambiar o reabrir una agenda existente usa update_agenda aunque el registro anterior figure finalizado; completa agenda_id si existe. Para eliminar usa delete_agenda solo ante una orden explícita de borrar/eliminar y deja que la app pida confirmación. new_type puede ser visita, construccion o trabajo; new_status puede ser agendado, esperando_detalles, reprogramado, finalizado, desistio o seguimiento solo si el Maestro lo pide explicitamente. Para finanzas y notas devuelve una propuesta para revisar; nunca afirmes que se guardo.',
      'Si pide enviar WhatsApp marca requires_consent true y no envies nada desde esta ruta.',
      '',
      'ORDEN:',
      text,
      '',
      'CLIENTE:',
      JSON.stringify(client || {}),
      '',
      'HISTORIAL:',
      history || '[sin historial]',
      '',
      'AGENDA:',
      JSON.stringify(agenda),
      '',
      'ALERTA ACTIVA:',
      appContext,
      '',
      'FOCO CONVERSACIONAL CONFIRMADO:',
      focusContext,
      '',
      'FORMULARIO ABIERTO:',
      formContext,
      '',
      'MEMORIA LIVE PERSISTENTE:',
      liveMemory || '[sin memoria Live]',
      '',
      'ESQUEMA:',
      '{"intent":"general","reply":"respuesta breve","client_name":"","phone":"","agenda_id":"","new_type":"","new_status":"","date":null,"time":null,"service":"","service_details":[],"location":"","maps_url":"","coordinates":null,"price":null,"amount":null,"category":"","description":"","note_title":"","note_text":"","message":"","media_url":"","media_type":"","scope":"","requires_consent":false}'
    ].join('\n');

    let response;
    let data = {};
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + GEMINI_KEY,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
          })
        }
      );
      data = await response.json().catch(() => ({}));
      if (response.ok) break;
      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt > 0) return res.status(502).json({ error: 'gemini_error', detail: geminiDetail(data) });
      await new Promise(resolve => setTimeout(resolve, 650));
    }
    if (!response?.ok) return res.status(502).json({ error: 'gemini_error', detail: geminiDetail(data) });

    const raw = data.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text || '{}';
    const action = JSON.parse(raw.trim());
    const normalizedOrder = normalizedOrderText(text);
    const explicitOrderDate = agendaDateFromOrderLima(text, nowLima.date);
    const explicitOrderTime = agendaTimeFromOrder(text);
    // Gemini may understand the request semantically, but the calendar value
    // is deterministic. A spoken weekday/time wins over model output every time.
    if (explicitOrderDate) action.date = explicitOrderDate;
    if (explicitOrderTime) action.time = explicitOrderTime;
    if (manualNewAgenda) {
      action.client_name = '';
      action.phone = cleanPhone(phoneFromText(text));
      action.maps_url = '';
      action.location = '';
      const explicitService = agendaServiceFromOrder(text);
      if (explicitService) action.service = explicitService;
    }
    // Guardia determinística: el modelo nunca puede convertir una orden de
    // agenda futura en un cierre financiero.
    if ((/\bagend(?:a|e|ar|ame|alo|ala)\b/.test(normalizedOrder) || /\b(?:guarda|guardar|guarde|registra|registrar|anota|anotar)\b/.test(normalizedOrder)) && /\b(?:construccion|trabajo|con(?:ex|ecc)ion|instalacion|modificacion|reparacion|punto|gasfiteria)\b/.test(normalizedOrder)) {
      action.intent = 'create_construction';
      action.new_type = 'construccion';
      action.new_status = 'agendado';
    } else if (/\breprogram|cambiar\s+(?:la\s+)?fecha|pospus|posterg/.test(normalizedOrder)) {
      action.intent = 'update_agenda';
      action.new_status = 'reprogramado';
    } else if (conversationFocus?.agendaId && isFocusedAgendaContinuation(text) && ['general', 'read_agenda', 'update_agenda'].includes(String(action.intent || 'general'))) {
      // Sigue la agenda ya visible/confirmada. Gemini mantiene la extracción
      // de fecha y hora; esta guardia solo evita perder el referente humano.
      action.intent = 'update_agenda';
      action.new_status = action.new_status || 'reprogramado';
    } else if (/\b(?:elimina|eliminar|borra|borrar)\b/.test(normalizedOrder) && /\b(?:agenda|visita|construccion|cita|registro)\b/.test(normalizedOrder)) {
      action.intent = 'delete_agenda';
    }
    const lockedPhone = cleanPhone(manualNewAgenda ? phone : (conversationFocus?.phone || activeAlert?.phone || pendingDraft?.phone || phone || ''));
    if (action.phone && !phoneIsTrusted(action.phone, lockedPhone, text)) {
      action.phone = '';
      action.phone_conflict = true;
    }
    if (!client && action.client_name && !phone) {
      candidates = await findClientsByName(action.client_name);
      if (candidates.length > 1) return res.status(200).json(ambiguityResponse(action.client_name, candidates));
      if (candidates.length === 1) {
        client = candidates[0];
        messages = await loadMessages(cleanPhone(client.phone_number));
      }
    }

    if (pendingDraft?.editId && ['general', 'update_agenda', 'create_visit', 'create_construction', 'create_followup'].includes(action.intent)) {
      action.intent = 'update_agenda';
      action.agenda_id = pendingDraft.editId;
      if (!action.client_name) action.client_name = pendingDraft.clientName || '';
      if (!action.phone) action.phone = pendingDraft.phone || '';
      const exactMessage = messages.slice().reverse().find((message) => message?.metadata?.direction !== 'outgoing' && isMapsUrl(message.maps_url));
      const latestMapsUrl = [exactMessage?.maps_url, activeAlert?.mapsUrl, action.maps_url, action.location, pendingDraft.mapsUrl].find(isMapsUrl) || '';
      if (latestMapsUrl) action.maps_url = latestMapsUrl;
      if (isMapsUrl(action.location)) action.location = pendingDraft.location || '';
      action.description = String(action.description || '').replace(/https?:\/\/\S+/gi, '').trim();
    }
    if (conversationFocus?.agendaId && ['update_agenda', 'delete_agenda'].includes(action.intent) && !action.agenda_id) action.agenda_id = conversationFocus.agendaId;
    if (conversationFocus?.clientName && !action.client_name) action.client_name = conversationFocus.clientName;
    if (conversationFocus?.phone && !action.phone) action.phone = conversationFocus.phone;

    const types = {
      create_visit: 'visita',
      create_construction: 'construccion',
      create_followup: 'seguimiento'
    };
    if (types[action.intent]) {
      action.reply = 'Preparé una propuesta de ' + types[action.intent] + '. Revisa el formulario y confirma antes de guardarla.';
    }
    let draft = null;
    let draftId = null;

    if (types[action.intent]) {
      const exactMessage = messages
        .slice()
        .reverse()
        .find((message) => isMapsUrl(message.maps_url));
      const mapCandidates = manualNewAgenda ? [action.maps_url, action.location] : [activeAlert?.mapsUrl, action.maps_url, action.location, exactMessage?.maps_url];
      const mapsUrl = mapCandidates.find(isMapsUrl) || '';
      const coordinates = mapsUrl ? extractCoordinatesFromMapsUrl(mapsUrl) : null;
      const requestedPrice = Number(action.price);
      const historyPrice = explicitPriceFromMessages(messages);
      const price = Number.isFinite(requestedPrice) && requestedPrice > 0 ? requestedPrice : historyPrice;

      draft = {
        kind: types[action.intent],
        clientName: manualNewAgenda ? '' : (conversationFocus?.clientName || activeAlert?.clientName || client?.name || action.client_name || requestedName || ''),
        phone: cleanPhone(manualNewAgenda ? action.phone : (conversationFocus?.phone || client?.phone_number || activeAlert?.phone || action.phone || phone)),
        date: action.date || '',
        time: action.time || '',
        service: action.service || '',
        serviceDetails: Array.isArray(action.service_details) ? action.service_details.filter(Boolean).slice(0, 3) : [],
        price,
        summary: action.reply || '',
        location: manualNewAgenda ? '' : (action.location || client?.address_summary || ''),
        notes: action.description || action.reply || '',
        mapsUrl,
        latitude: coordinates?.lat ?? null,
        longitude: coordinates?.lng ?? null,
        confidence: coordinates ? 'high' : (mapsUrl ? 'medium' : 'low'),
        sourceAlertId: activeAlert?.id || null,
        phoneConflict: Boolean(action.phone_conflict)
      };
      const missing = [];
      if (!draft.clientName) missing.push('cliente');
      if (!draft.date) missing.push('fecha');
      if (!draft.time) missing.push('hora');
      if (!draft.phone) missing.push('teléfono');
      if (!draft.location && !draft.mapsUrl) missing.push('ubicación');
      if (draft.kind === 'construccion' && !draft.service) missing.push('servicio');
      if (draft.kind === 'construccion' && !(draft.price > 0)) missing.push('precio');
      draft.missing = missing;

      if (SUPABASE_KEY) {
        const draftResponse = await supabase('/rest/v1/draft_actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify([{
            client_id: client?.legacy_client_id || (client?.source === 'clients' ? client?.id : null) || null,
            type: draft.kind,
            status: 'pending_review',
            payload: { ...draft, summary_update: action.reply || '' }
          }])
        });
        if (draftResponse.response.ok && Array.isArray(draftResponse.data) && draftResponse.data[0]?.id) draftId = draftResponse.data[0].id;
      }
    }

    return res.status(200).json({
      reply: String(action.reply || 'Orden analizada.'),
      action,
      draft: draft ? { ...draft, _draftId: draftId } : null,
      requiresConsent: Boolean(action.requires_consent),
      requiresDisambiguation: false,
      matches: publicCandidates(candidates),
      resolvedClient: client ? { id: client.id || '', name: client.name || '', phone: cleanPhone(client.phone_number || '') } : null,
      model: GEMINI_MODEL
    });
  } catch (error) {
    console.error('[ASSISTANT COMMAND]', JSON.stringify({ category: errorCode(error) || 'request_failed' }));
    return res.status(500).json({ error: 'assistant_command_failed' });
  }
};
