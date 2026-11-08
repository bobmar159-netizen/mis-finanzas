/**
 * API ROUTE / SERVICIO DE APROBACIÓN DE BORRADORES (Human-in-the-Loop)
 * /api/actions/approve
 * Aprueba el borrador, actualiza el perfil del cliente y sincroniza en paralelo con Calendar, Sheets y Notion.
 */

const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticateScopedOwner, blockedOwnerInput, scopedContact } = require('../../lib/yarbi-authenticated-route');
let SUPABASE_URL = '';
let SUPABASE_KEY = '';

// Credenciales / Variables de Entorno para Integraciones
const NOTION_TOKEN = process.env.NOTION_TOKEN || process.env.FNZ_NOTION_TOKEN || '';
const NOTION_DB_AGENDA = process.env.NOTION_DB_AGENDA || process.env.FNZ_NOTION_DB_AGENDA || '';
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL || process.env.FNZ_SHEETS_URL || '';
const GOOGLE_CALENDAR_CLIENT_EMAIL = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL || '';
const GOOGLE_CALENDAR_PRIVATE_KEY = process.env.GOOGLE_CALENDAR_PRIVATE_KEY || '';

function cleanPhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('51') && phone.length === 11) phone = phone.slice(2);
  return phone.slice(0, 20);
}

function keyPart(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function limaStartAt(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return '';
  const safeTime = /^\d{2}:\d{2}$/.test(String(time || '')) ? time : '09:00';
  return String(date) + 'T' + safeTime + ':00-05:00';
}

function sameInstant(left, right) {
  const leftMs = Date.parse(String(left || ''));
  const rightMs = Date.parse(String(right || ''));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { response, data };
}

async function resolveCanonicalContact(payload, scope) {
  const phone = cleanPhone(payload.phone);
  if (!phone) return null;
  const identifier = await supabaseRequest('/rest/v1/contact_identifiers?identifier_type=eq.phone&normalized_value=eq.' + encodeURIComponent(phone) + '&select=contact_id&limit=1');
  const existingId = Array.isArray(identifier.data) ? identifier.data[0]?.contact_id : null;
  if (existingId) {
    if (!scopedContact(scope, existingId)) {
      const error = new Error('owner_scope_forbidden'); error.code = error.message; throw error;
    }
    const trustedNameSource = /^(android_phonebook|phonebook|local_agenda|master_explicit|manual|user)$/i.test(String(payload.client_name_source || ''));
    if (trustedNameSource && String(payload.client_name || '').trim()) {
      const renamed = await supabaseRequest('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(existingId)), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ full_name: String(payload.client_name).trim().slice(0, 240), display_name: String(payload.client_name).trim().slice(0, 240), source: 'yarbi_form' })
      });
      if (!renamed.response.ok) throw new Error('No se pudo conservar el nombre verificado del teléfono');
    }
    return Number(existingId);
  }
  // Crear un contacto aquí no permite demostrar a qué dueño pertenece sin
  // escribir la relación canónica. Cerramos la operación antes de cualquier
  // escritura lateral hasta que exista esa transacción explícita.
  const error = new Error('owner_scope_new_contact_unavailable'); error.code = error.message; throw error;
}

async function payloadContactIsScoped(payload, scope) {
  const phone = cleanPhone(payload?.phone);
  if (!phone) return false;
  const identifier = await supabaseRequest('/rest/v1/contact_identifiers?identifier_type=eq.phone&normalized_value=eq.' + encodeURIComponent(phone) + '&select=contact_id&limit=1');
  const contactId = Array.isArray(identifier.data) ? identifier.data[0]?.contact_id : null;
  return identifier.response.ok && scopedContact(scope, contactId);
}

async function upsertCanonicalAgenda(payload, scope) {
  const startsAt = limaStartAt(payload.date, payload.time);
  if (!startsAt) throw new Error('Fecha inválida para la agenda remota');
  const requestedEventId = Number(payload.agenda_event_id);
  let requestedEvent = null;
  if (Number.isInteger(requestedEventId) && requestedEventId > 0) {
    const target = await supabaseRequest('/rest/v1/agenda_events?id=eq.' + encodeURIComponent(String(requestedEventId)) + '&source=eq.yarbi_form&select=id,contact_id&limit=1');
    if (!target.response.ok) throw new Error('No se pudo comprobar el evento remoto a actualizar');
    requestedEvent = Array.isArray(target.data) ? target.data[0] : null;
    if (!requestedEvent?.id) throw new Error('El evento remoto indicado no pertenece a Yarbi');
    if (!scopedContact(scope, requestedEvent.contact_id)) { const error = new Error('owner_scope_forbidden'); error.code = error.message; throw error; }
  }
  const phone = cleanPhone(payload.phone);
  const type = payload.type === 'trabajo' || payload.type === 'construccion' ? 'construccion' : payload.type === 'seguimiento' ? 'seguimiento' : 'visita';
  const dedupeKey = ['yarbi-form-v1', phone || keyPart(payload.client_name), type, payload.date, payload.time || '09:00', keyPart(payload.service)].join(':');
  const contactId = requestedEvent?.contact_id || await resolveCanonicalContact(payload, scope);
  const label = type === 'construccion' ? 'Construcción' : type === 'seguimiento' ? 'Seguimiento' : 'Visita';
  const event = {
    contact_id: contactId,
    event_type: type,
    title: (label + ': ' + payload.client_name).slice(0, 240),
    service: String(payload.service || '').slice(0, 240) || null,
    description: String(payload.notes || '').slice(0, 4000) || null,
    location: String(payload.location || '').slice(0, 500) || null,
    maps_url: String(payload.maps_url || '').slice(0, 1000) || null,
    starts_at: startsAt,
    timezone: 'America/Lima',
    status: payload.status === 'completed' ? 'completed' : payload.status === 'confirmed' ? 'confirmed' : payload.status === 'cancelled' ? 'cancelled' : payload.status === 'no_show' ? 'no_show' : 'pending',
    source: 'yarbi_form',
    dedupe_key: dedupeKey
  };
  let parentEventId = Number(payload.parent_event_id) || null;
  if (!parentEventId && payload.parent_local_id) {
    const parent = await supabaseRequest('/rest/v1/agenda_events?local_ref=eq.' + encodeURIComponent(String(payload.parent_local_id)) + '&source=eq.yarbi_form&select=id&limit=1');
    if (parent.response.ok) parentEventId = Number(Array.isArray(parent.data) ? parent.data[0]?.id : 0) || null;
  }
  const extendedEvent = {
    ...event,
    price: Number(payload.price) > 0 ? Number(payload.price) : null,
    service_details: Array.isArray(payload.service_details) ? payload.service_details.filter(Boolean).slice(0, 3) : [],
    parent_event_id: parentEventId,
    parent_local_id: String(payload.parent_local_id || '').slice(0, 120) || null,
    local_ref: String(payload.local_ref || '').slice(0, 120) || null,
    metadata: { client_name_source: String(payload.client_name_source || ''), saved_by: 'yarbi_app' }
  };
  let eventId = requestedEvent?.id || null;
  if (eventId) {
    const collision = await supabaseRequest('/rest/v1/agenda_events?dedupe_key=eq.' + encodeURIComponent(dedupeKey) + '&select=id&limit=1');
    if (!collision.response.ok) throw new Error('No se pudo comprobar duplicados de agenda');
    const collisionId = Array.isArray(collision.data) ? collision.data[0]?.id : null;
    if (collisionId && String(collisionId) !== String(eventId)) throw new Error('Ya existe otro evento canónico con ese horario');
  } else {
    const existing = await supabaseRequest('/rest/v1/agenda_events?dedupe_key=eq.' + encodeURIComponent(dedupeKey) + '&select=id&limit=1');
    if (!existing.response.ok) throw new Error('No se pudo comprobar duplicados de agenda');
    eventId = Array.isArray(existing.data) ? existing.data[0]?.id : null;
  }
  // Una segunda orden puede completar servicio/precio y cambiar la llave histórica.
  // El evento canónico sigue siendo el mismo cliente, tipo y horario: se actualiza.
  if (!eventId && contactId) {
    const sameSlot = await supabaseRequest('/rest/v1/agenda_events?contact_id=eq.' + encodeURIComponent(String(contactId)) + '&event_type=eq.' + encodeURIComponent(type) + '&starts_at=eq.' + encodeURIComponent(startsAt) + '&source=eq.yarbi_form&select=id&order=updated_at.desc&limit=1');
    if (!sameSlot.response.ok) throw new Error('No se pudo comprobar el horario canónico de agenda');
    eventId = Array.isArray(sameSlot.data) ? sameSlot.data[0]?.id : null;
  }
  const savePath = '/rest/v1/agenda_events' + (eventId ? '?id=eq.' + encodeURIComponent(String(eventId)) : '');
  const saveOptions = body => ({
    method: eventId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(eventId ? body : [body])
  });
  let extendedColumnsPersisted = true;
  let saved = await supabaseRequest(savePath, saveOptions(extendedEvent));
  if (!saved.response.ok && /column|schema cache|price|service_details|parent_event_id|local_ref|metadata/i.test(JSON.stringify(saved.data || ''))) {
    extendedColumnsPersisted = false;
    saved = await supabaseRequest(savePath, saveOptions(event));
  }
  const row = Array.isArray(saved.data) ? saved.data[0] : null;
  if (!saved.response.ok || !row?.id) throw new Error('No se pudo guardar la agenda en Supabase');
  const readFields = 'id,contact_id,event_type,service,location,maps_url,starts_at,status,source,dedupe_key' + (extendedColumnsPersisted ? ',price,service_details,parent_event_id,parent_local_id,local_ref,metadata' : '');
  const readBack = await supabaseRequest('/rest/v1/agenda_events?id=eq.' + encodeURIComponent(String(row.id)) + '&select=' + readFields + '&limit=1');
  const confirmed = Array.isArray(readBack.data) ? readBack.data[0] : null;
  const readBackMatches = readBack.response.ok && confirmed &&
    String(confirmed.id) === String(row.id) &&
    String(confirmed.contact_id || '') === String(contactId || '') &&
    String(confirmed.event_type || '') === String(event.event_type || '') &&
    String(confirmed.service || '') === String(event.service || '') &&
    String(confirmed.location || '') === String(event.location || '') &&
    String(confirmed.maps_url || '') === String(event.maps_url || '') &&
    sameInstant(confirmed.starts_at, event.starts_at) &&
    String(confirmed.status || '') === String(event.status || '') &&
    String(confirmed.source || '') === 'yarbi_form' &&
    String(confirmed.dedupe_key || '') === String(dedupeKey || '');
  if (!readBackMatches) throw new Error('Supabase escribió la agenda, pero el read-back no confirmó sus datos');
  return { id: confirmed.id, contactId, created: !eventId, dedupeKey, readBackVerified: true, extendedColumnsPersisted };
}

async function deleteCanonicalAgenda(input = {}, scope) {
  const agendaEventId = Number(input.agenda_event_id) || 0;
  const localRef = String(input.local_ref || '').trim().slice(0, 120);
  if (!agendaEventId && !localRef) throw new Error('agenda_identifier_required');
  const filter = agendaEventId
    ? 'id=eq.' + encodeURIComponent(String(agendaEventId))
    : 'local_ref=eq.' + encodeURIComponent(localRef);
  const lookup = await supabaseRequest('/rest/v1/agenda_events?' + filter + '&source=eq.yarbi_form&select=id,local_ref,contact_id&limit=1');
  if (!lookup.response.ok) throw new Error('agenda_lookup_failed');
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!row?.id) return { deleted: true, already_absent: true, local_ref: localRef || null };
  if (!scopedContact(scope, row.contact_id)) { const error = new Error('owner_scope_forbidden'); error.code = error.message; throw error; }
  const removed = await supabaseRequest('/rest/v1/agenda_events?id=eq.' + encodeURIComponent(String(row.id)) + '&source=eq.yarbi_form', {
    method: 'DELETE', headers: { Prefer: 'return=representation' }
  });
  if (!removed.response.ok) throw new Error('agenda_delete_failed');
  const readBack = await supabaseRequest('/rest/v1/agenda_events?id=eq.' + encodeURIComponent(String(row.id)) + '&select=id&limit=1');
  const stillExists = Array.isArray(readBack.data) && readBack.data.length > 0;
  if (!readBack.response.ok || stillExists) throw new Error('agenda_delete_not_verified');
  return { deleted: true, agenda_event_id: row.id, local_ref: row.local_ref || localRef || null, readback_verified: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const runtime = validateServerRouteConfig({ requirePublicAuth: true });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  SUPABASE_URL = runtime.supabaseUrl;
  SUPABASE_KEY = runtime.supabaseKey;

  try {
    const { draft_id, payload, operation } = req.body || {};
    if (blockedOwnerInput(req.body || {})) return res.status(400).json({ error: 'owner_scope_client_input_forbidden' });
    const access = await authenticateScopedOwner(req, runtime, supabaseRequest);
    if (!access.ok) return res.status(access.status).json({ error: access.code });

    if (operation === 'delete_agenda') {
      const result = await deleteCanonicalAgenda(req.body || {}, access.scope);
      return res.status(200).json(result);
    }

    if (!payload || !payload.client_name) {
      return res.status(400).json({ error: 'Faltan datos obligatorios del borrador (client_name)' });
    }
    if (!(await payloadContactIsScoped(payload, access.scope))) {
      return res.status(403).json({ error: 'owner_scope_forbidden' });
    }

    console.log(`[APROBANDO BORRADOR ${draft_id}] Cliente: ${payload.client_name} | Tipo: ${payload.type || 'visita'}`);

    const syncResults = {
      supabase_draft: false,
      supabase_client: false,
      supabase_agenda: false,
      supabase_agenda_readback: false,
      agenda_event_id: null,
      agenda_created: false,
      google_calendar: false,
      google_sheets: false,
      notion: false,
      errors: []
    };

    // 1. Cambiar estado de draft_actions a 'approved'
    if (draft_id) {
      try {
        const draftRes = await fetch(`${SUPABASE_URL}/rest/v1/draft_actions?id=eq.${draft_id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            status: 'approved',
            payload: payload
          })
        });
        if (draftRes.ok) syncResults.supabase_draft = true;
      } catch(dErr) {
        syncResults.errors.push('Supabase draft status error: ' + dErr.message);
      }
    }

    // 2. Actualizar perfil del cliente en `clients`
    if (payload.phone) {
      try {
        const clientRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?phone_number=eq.${payload.phone}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: payload.client_name,
            address_summary: payload.location || ''
          })
        });
        if (clientRes.ok) syncResults.supabase_client = true;
      } catch(cErr) {
        syncResults.errors.push('Supabase client update error: ' + cErr.message);
      }
    }

    // 3. Supabase es la fuente de verdad de agenda. La sincronización externa
    // nunca puede convertir un guardado remoto fallido en un “éxito”.
    try {
      const canonicalAgenda = await upsertCanonicalAgenda(payload, access.scope);
      syncResults.supabase_agenda = true;
      syncResults.supabase_agenda_readback = canonicalAgenda.readBackVerified === true;
      syncResults.agenda_event_id = canonicalAgenda.id;
      syncResults.agenda_created = canonicalAgenda.created;
    } catch (agendaError) {
      syncResults.errors.push('Supabase agenda error: ' + agendaError.message);
    }

    // 4. Sincronización en paralelo con servicios externos (Calendar, Sheets, Notion).
    // Una importación histórica solo reconstruye el índice CRM/Agenda: jamás
    // vuelve a crear filas antiguas en Notion, Calendar o Sheets.
    const syncPromises = [];
    const historicalImport = payload.historical_import === true;

    // A) Sincronización con Notion API
    if (!historicalImport && NOTION_TOKEN && NOTION_DB_AGENDA) {
      syncPromises.push((async () => {
        try {
          const nRes = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${NOTION_TOKEN}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              parent: { database_id: NOTION_DB_AGENDA },
              properties: {
                'Cliente': { title: [{ text: { content: payload.client_name } }] },
                'Tipo': { select: { name: (payload.type || 'visita').toUpperCase() } },
                'Fecha': payload.date ? { date: { start: payload.date } } : undefined,
                'Servicio': { rich_text: [{ text: { content: payload.service || '' } }] },
                'Ubicacion': { rich_text: [{ text: { content: payload.location || '' } }] },
                'Maps': payload.maps_url ? { url: payload.maps_url } : undefined,
                'Precio': payload.price ? { number: parseFloat(payload.price) } : undefined
              }
            })
          });
          if (nRes.ok) {
            syncResults.notion = true;
          } else {
            const nErr = await nRes.text();
            syncResults.errors.push('Notion HTTP ' + nRes.status + ': ' + nErr);
          }
        } catch(nErr) {
          syncResults.errors.push('Notion Exception: ' + nErr.message);
        }
      })());
    }

    // B) Sincronización con Google Sheets Apps Script API
    if (!historicalImport && GOOGLE_SHEETS_URL) {
      syncPromises.push((async () => {
        try {
          const sRes = await fetch(GOOGLE_SHEETS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add_agenda',
              data: {
                tipo: payload.type || 'visita',
                cliente: payload.client_name,
                telefono: payload.phone || '',
                fecha: payload.date || '',
                hora: payload.time || '',
                servicio: payload.service || '',
                ubicacion: payload.location || '',
                maps: payload.maps_url || '',
                precio: payload.price || 0,
                estado: 'confirmado'
              }
            })
          });
          if (sRes.ok) {
            syncResults.google_sheets = true;
          } else {
            syncResults.errors.push('Google Sheets HTTP ' + sRes.status);
          }
        } catch(sErr) {
          syncResults.errors.push('Google Sheets Exception: ' + sErr.message);
        }
      })());
    }

    // C) Sincronización con Google Calendar API (Servidor HTTP / Apps Script fallback)
    if (!historicalImport && payload.date) {
      if (!GOOGLE_SHEETS_URL) {
        syncResults.errors.push('Google Sheets/Calendar URL no configurada');
      }
      syncPromises.push((async () => {
        try {
          // Intentar crear evento vía Apps Script / Google Calendar Integration
          if (GOOGLE_SHEETS_URL) {
            const calRes = await fetch(GOOGLE_SHEETS_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'create_calendar_event',
                event: {
                  title: `📍 ${payload.type ? payload.type.toUpperCase() : 'VISITA'}: ${payload.client_name}`,
                  description: `Cliente: ${payload.client_name}\nCel: ${payload.phone || 'Sin cel'}\nServicio: ${payload.service || ''}\nUbicación: ${payload.location || ''}\nMaps: ${payload.maps_url || ''}`,
                  date: payload.date,
                  time: payload.time || '09:00',
                  location: payload.maps_url || payload.location || 'Lima, Perú'
                }
              })
            });
            if (calRes.ok) syncResults.google_calendar = true;
          }
        } catch(cErr) {
          syncResults.errors.push('Google Calendar Exception: ' + cErr.message);
        }
      })());
    }

    if (historicalImport) {
      syncResults.historical_import = true;
    }

    // Esperar a que todas las sincronizaciones paralelas terminen
    await Promise.allSettled(syncPromises);

    console.log('[APROBACIÓN COMPLETADA]:', JSON.stringify(syncResults, null, 2));

    return res.status(200).json({
      status: syncResults.errors.length ? 'partial' : 'success',
      message: syncResults.errors.length ? 'The action was saved, but one or more external synchronizations failed.' : 'Action approved and synchronized successfully.',
      syncResults
    });

  } catch (err) {
    console.error('[APPROVE ACTION ERROR]', err);
    return res.status(500).json({ error: err.message });
  }
}

