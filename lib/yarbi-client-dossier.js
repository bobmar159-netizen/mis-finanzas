function text(value, max = 1000) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (typeof value.value === 'string') value = value.value;
    else value = JSON.stringify(value);
  }
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function key(value) {
  return text(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function isoDate(value) {
  const raw = text(value, 80);
  const direct = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (direct) return direct[0];
  const local = raw.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (!local) return '';
  return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
}

function clockTime(value) {
  const raw = text(value, 80).toLowerCase();
  const match = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = String(match[3] || '').replace(/\./g, '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function money(value) {
  const raw = text(value, 120).replace(/,/g, '.');
  const matches = raw.match(/\d+(?:\.\d{1,2})?/g);
  if (!matches?.length) return 0;
  const parsed = Number(matches[matches.length - 1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function agendaParts(row) {
  const millis = new Date(row?.starts_at || '').getTime();
  if (!Number.isFinite(millis)) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(millis));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}` };
}

function latest(rows, field = 'updated_at') {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => String(b?.[field] || b?.observed_at || b?.created_at || '').localeCompare(String(a?.[field] || a?.observed_at || a?.created_at || '')));
}

function observationFor(rows, names) {
  const accepted = new Set(names.map(key));
  return latest(rows, 'observed_at').find(row => {
    if (String(row?.status || 'active') !== 'active' || String(row?.observation_type || '') !== 'fact') return false;
    const category = key(row?.category);
    return accepted.has(category) || [...accepted].some(name => category.includes(name));
  }) || null;
}

function provenance(source, row, messageIds) {
  return { source, source_id: row?.id == null ? null : String(row.id), source_message_ids: Array.from(new Set((messageIds || row?.source_message_ids || []).map(String).filter(Boolean))).slice(0, 12) };
}

function buildClientDossier(input = {}) {
  const contact = input.contact || {};
  const memory = input.memory || {};
  const observations = Array.isArray(input.observations) ? input.observations : [];
  const analyses = latest((input.analyses || []).filter(row => String(row?.status || '') === 'completed'), 'completed_at');
  const messages = [...(input.messages || [])].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
  const agenda = [...(input.agenda || [])].sort((a, b) => String(b?.updated_at || b?.starts_at || '').localeCompare(String(a?.updated_at || a?.starts_at || '')));
  const extracted = analyses[0]?.extracted_data && typeof analyses[0].extracted_data === 'object' ? analyses[0].extracted_data : {};
  const appointment = extracted.appointment && typeof extracted.appointment === 'object' ? extracted.appointment : {};
  const usableAgenda = agenda.find(row => !/cancel|complet|no_show/i.test(String(row?.status || ''))) || agenda[0] || null;
  const agendaClock = agendaParts(usableAgenda);
  const facts = {
    clientName: observationFor(observations, ['client_name', 'nombre_cliente', 'nombre']),
    phone: observationFor(observations, ['phone', 'telefono', 'celular']),
    service: observationFor(observations, ['service', 'servicio']),
    date: observationFor(observations, ['appointment_date', 'fecha_visita', 'fecha_trabajo', 'fecha']),
    time: observationFor(observations, ['appointment_time', 'hora_visita', 'hora_trabajo', 'hora']),
    price: observationFor(observations, ['price', 'precio', 'monto', 'cotizacion', 'presupuesto']),
    location: observationFor(observations, ['location', 'ubicacion', 'direccion', 'distrito']),
    district: observationFor(observations, ['district', 'distrito']),
    maps: observationFor(observations, ['maps_url', 'google_maps', 'enlace_ubicacion'])
  };
  const latestMapMessage = messages.find(row => /^https?:\/\//i.test(String(row?.maps_url || '')));
  const latestVerifiedDistrict = messages.map(row => text(row?.metadata?.location_district, 160)).find(Boolean);
  const dossier = {
    client_name: text(contact.display_name || contact.full_name || facts.clientName?.value, 160),
    phone: text(input.phone || facts.phone?.value, 30).replace(/\D/g, ''),
    service: text(appointment.service || extracted.service || facts.service?.value || memory.latest_service || usableAgenda?.service, 300),
    appointment_date: isoDate(appointment.date || facts.date?.value) || agendaClock.date,
    appointment_time: clockTime(appointment.time || facts.time?.value) || agendaClock.time,
    price: money(facts.price?.value),
    location: text(appointment.location || facts.location?.value || usableAgenda?.location, 1000),
    district: text(facts.district?.value || latestVerifiedDistrict, 160),
    maps_url: text(appointment.maps_url || latestMapMessage?.maps_url || facts.maps?.value || usableAgenda?.maps_url, 2000),
    commercial_status: text(contact.commercial_status, 80),
    operational_status: text(contact.operational_status, 120),
    operational_reason: text(contact.operational_reason, 500),
    agenda_event_id: usableAgenda?.id == null ? null : String(usableAgenda.id),
    evidence: {}
  };
  dossier.evidence.client_name = provenance(contact.id ? 'crm_contact' : 'observation', contact.id ? contact : facts.clientName);
  dossier.evidence.phone = provenance(input.phone ? 'contact_identifier' : 'observation', facts.phone);
  dossier.evidence.service = appointment.service || extracted.service ? provenance('latest_analysis', analyses[0]) : facts.service ? provenance('observation', facts.service) : provenance(usableAgenda?.service ? 'agenda' : 'memory', usableAgenda);
  dossier.evidence.appointment_date = appointment.date ? provenance('latest_analysis', analyses[0]) : facts.date ? provenance('observation', facts.date) : provenance('agenda', usableAgenda);
  dossier.evidence.appointment_time = appointment.time ? provenance('latest_analysis', analyses[0]) : facts.time ? provenance('observation', facts.time) : provenance('agenda', usableAgenda);
  dossier.evidence.price = provenance('observation', facts.price);
  dossier.evidence.location = appointment.location ? provenance('latest_analysis', analyses[0]) : facts.location ? provenance('observation', facts.location) : provenance('agenda', usableAgenda);
  dossier.evidence.district = facts.district ? provenance('observation', facts.district) : latestVerifiedDistrict ? provenance('whatsapp_message', messages.find(row => text(row?.metadata?.location_district, 160) === latestVerifiedDistrict)) : provenance('agenda', usableAgenda);
  dossier.evidence.maps_url = latestMapMessage ? provenance('whatsapp_message', latestMapMessage, [latestMapMessage.id]) : appointment.maps_url ? provenance('latest_analysis', analyses[0]) : facts.maps ? provenance('observation', facts.maps) : provenance('agenda', usableAgenda);
  dossier.missing = ['client_name', 'phone', 'service', 'appointment_date', 'appointment_time', 'location'].filter(field => !dossier[field]);
  const latestMessage = messages[0] || {};
  dossier.conversation_brief = [
    dossier.commercial_status ? 'Interés ' + dossier.commercial_status : '',
    dossier.operational_status ? 'estado ' + dossier.operational_status.replace(/_/g, ' ') : '',
    memory.follow_up_status ? 'siguiente paso: ' + text(memory.follow_up_status, 220) : '',
    memory.summary ? text(memory.summary, 420) : '',
    latestMessage?.timestamp ? 'última interacción registrada' : ''
  ].filter(Boolean).join('. ');
  return dossier;
}

module.exports = { buildClientDossier, clockTime, isoDate, money };
