/**
 * Resolve exact locations from WhatsApp pins and Google Maps links.
 * Never invents coordinates and never falls back to a district search.
 */

function isValidCoordinates(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function decodeUrlSafely(value) {
  try { return decodeURIComponent(String(value)); } catch (_) { return String(value); }
}

function validCoordinatePair(latValue, lngValue) {
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return isValidCoordinates(lat, lng) ? { lat, lng } : null;
}

// A district is useful as a human clue, but it must never be guessed from a
// coordinate alone. Google short links frequently expand to a place/address
// that includes the district; native WhatsApp pins can include it too. We only
// expose one when it literally appears in verified location data.
const LIMA_DISTRICTS = [
  'Villa El Salvador', 'Villa Maria del Triunfo', 'San Juan de Lurigancho',
  'San Juan de Miraflores', 'Santiago de Surco', 'San Martin de Porres',
  'San Miguel', 'Santa Maria del Mar', 'Santa Rosa', 'Santa Anita',
  'Punta Hermosa', 'Punta Negra', 'Pueblo Libre', 'Puente Piedra',
  'Los Olivos', 'La Victoria', 'La Molina', 'Lurin', 'Lince', 'Lima',
  'Jesus Maria', 'Independencia', 'Chorrillos', 'Cieneguilla', 'Carabayllo',
  'Carmen de la Legua', 'Bellavista', 'Breña', 'Barranco', 'Ate',
  'Ancon', 'El Agustino', 'Comas', 'Callao', 'Miraflores', 'Surquillo',
  'San Isidro', 'San Borja', 'Magdalena del Mar', 'Rimac', 'Surco',
  'Chaclacayo', 'Chosica', 'La Perla', 'La Punta', 'Ventanilla'
];

function normalizeDistrictText(value) {
  return decodeUrlSafely(String(value || ''))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[+_/,;|()\[\]{}]/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ').toLowerCase()
    .replace(/\s+/g, ' ').trim();
}

function extractLimaDistrict(...values) {
  const source = normalizeDistrictText(values.filter(Boolean).join(' '));
  if (!source) return '';
  const sorted = [...LIMA_DISTRICTS].sort((a, b) => b.length - a.length);
  for (const district of sorted) {
    const normalized = normalizeDistrictText(district);
    if (new RegExp('(^|\\s)' + normalized.replace(/\s+/g, '\\s+') + '(?=\\s|$)', 'i').test(source)) return district;
  }
  return '';
}

function resolveWhatsAppNativeLocation(loc) {
  const coords = validCoordinatePair(loc && loc.latitude, loc && loc.longitude);
  const addressParts = [loc?.name, loc?.address].filter(Boolean);
  const district = extractLimaDistrict(...addressParts);
  if (!coords) return { resolvedUrl: "", lat: null, lng: null, formattedAddress: loc && (loc.address || loc.name) || null, district, hasExactCoordinates: false, isNativeLocation: true };
  const resolvedUrl = "https://www.google.com/maps/search/?api=1&query=" + coords.lat + "," + coords.lng;
  return { resolvedUrl, lat: coords.lat, lng: coords.lng, formattedAddress: addressParts.length ? addressParts.join(" - ") : "Coordenadas: " + coords.lat + ", " + coords.lng, district, hasExactCoordinates: true, isNativeLocation: true };
}

function extractCoordinatesFromMapsUrl(url) {
  if (!url) return null;
  const decoded = decodeUrlSafely(String(url).trim());
  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?)[,%2C\s]+(-?\d+(?:\.\d+)?)/i,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /(?:place|search)\/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) {
      const coords = validCoordinatePair(match[1], match[2]);
      if (coords) return coords;
    }
  }
  return null;
}

// This is deliberately server-environment-only. A request header or message
// cannot enable this preview isolation mode.
function isSyntheticPreviewNetworkIsolation(env = process.env) {
  return String(env?.VERCEL_ENV || '').trim() === 'preview'
    && String(env?.YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY || '').trim().toLowerCase() === 'true';
}

async function resolveGoogleMapsUrl(inputUrl) {
  const source = String(inputUrl || "").trim();
  const urlMatch = source.match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.com\/maps|maps\.google\.[a-z.]+|[a-z0-9-]+\.google\.[a-z.]+\/maps)[^\s<>]*/i);
  const targetUrl = urlMatch ? urlMatch[0].replace(/[.,;!?)]+$/, "") : source;
  if (isSyntheticPreviewNetworkIsolation()) {
    // Do not follow short links, redirects, or any Maps URL in the synthetic
    // preview. The input is retained only as source evidence; no location is
    // inferred or invented.
    return {
      resolvedUrl: "", sourceUrl: targetUrl, lat: null, lng: null,
      formattedAddress: null, district: "", hasExactCoordinates: false,
      isNativeLocation: false, resolution_status: 'preview_synthetic_network_disabled'
    };
  }
  let finalUrl = targetUrl;
  try {
    const response = await fetch(targetUrl, { method: "GET", redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 YarbiLocationResolver/1.0" } });
    finalUrl = response.url || targetUrl;
  } catch (error) {
    console.warn("[LOCATION RESOLVER] Could not follow map URL:", error.message);
  }
  const coords = extractCoordinatesFromMapsUrl(finalUrl) || extractCoordinatesFromMapsUrl(targetUrl);
  const district = extractLimaDistrict(targetUrl, finalUrl);
  if (!coords) return { resolvedUrl: "", sourceUrl: targetUrl, lat: null, lng: null, formattedAddress: null, district, hasExactCoordinates: false, isNativeLocation: false };
  return { resolvedUrl: "https://www.google.com/maps/search/?api=1&query=" + coords.lat + "," + coords.lng, sourceUrl: targetUrl, lat: coords.lat, lng: coords.lng, formattedAddress: "Coordenadas: " + coords.lat + ", " + coords.lng, district, hasExactCoordinates: true, isNativeLocation: false };
}

async function processLocationInput(value) {
  if (!value) return null;
  if (typeof value === "object" && value.latitude != null && value.longitude != null) return resolveWhatsAppNativeLocation(value);
  if (typeof value === "string" && /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.com\/maps|maps\.google\.[a-z.]+|[a-z0-9-]+\.google\.[a-z.]+\/maps)/i.test(value)) return resolveGoogleMapsUrl(value);
  return null;
}

module.exports = { resolveWhatsAppNativeLocation, extractCoordinatesFromMapsUrl, extractLimaDistrict, resolveGoogleMapsUrl, processLocationInput, isValidCoordinates, isSyntheticPreviewNetworkIsolation };
