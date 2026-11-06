/**
 * MÓDULO DE RESOLUCIÓN DE UBICACIÓN (Google Maps & WhatsApp Native Location)
 * Antigravity CRM - Operational Assistant
 */

export interface LocationResult {
  resolvedUrl: string;
  lat: number | null;
  lng: number | null;
  formattedAddress: string | null;
  isNativeLocation: boolean;
}

export interface WhatsAppNativeLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/**
 * Procesa una ubicación nativa recibida en el webhook de WhatsApp (type: "location")
 */
export function resolveWhatsAppNativeLocation(loc: WhatsAppNativeLocation): LocationResult {
  const lat = typeof loc.latitude === 'number' ? loc.latitude : parseFloat(String(loc.latitude));
  const lng = typeof loc.longitude === 'number' ? loc.longitude : parseFloat(String(loc.longitude));

  if (isNaN(lat) || isNaN(lng)) {
    return {
      resolvedUrl: '',
      lat: null,
      lng: null,
      formattedAddress: loc.address || loc.name || null,
      isNativeLocation: true
    };
  }

  const resolvedUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const addressParts = [loc.name, loc.address].filter(Boolean);
  const formattedAddress = addressParts.length > 0 ? addressParts.join(' - ') : `Coordenadas: ${lat}, ${lng}`;

  return {
    resolvedUrl,
    lat,
    lng,
    formattedAddress,
    isNativeLocation: true
  };
}

/**
 * Extrae las coordenadas latitud y longitud de cualquier formato de URL de Google Maps usando expresiones regulares
 */
export function extractCoordinatesFromMapsUrl(url: string): { lat: number; lng: number } | null {
  if (!url) return null;

  // Patrón 1: /@(-?\d+\.\d+),(-?\d+\.\d+)
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }

  // Patrón 2: q=(-?\d+\.\d+),(-?\d+\.\d+) o ll=(-?\d+\.\d+),(-?\d+\.\d+)
  const qMatch = url.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) {
    return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
  }

  // Patrón 3: /3d(-?\d+\.\d+)!4d(-?\d+\.\d+) (Embed / Direct URLs)
  const dMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (dMatch) {
    return { lat: parseFloat(dMatch[1]), lng: parseFloat(dMatch[2]) };
  }

  // Patrón 4: /place/lat,lng or /search/lat,lng
  const placeMatch = url.match(/(?:place|search)\/(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (placeMatch) {
    return { lat: parseFloat(placeMatch[1]), lng: parseFloat(placeMatch[2]) };
  }

  return null;
}

/**
 * Resuelve un enlace corto de Google Maps (maps.app.goo.gl, goo.gl/maps, etc.) siguiendo las redirecciones HTTP
 */
export async function resolveGoogleMapsUrl(inputUrl: string): Promise<LocationResult> {
  const urlMatch = inputUrl.match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.com\/maps|maps\.google\.[a-z.]+|[a-z0-9\-]+\.google\.[a-z.]+\/maps)\S*/i);
  const targetUrl = urlMatch ? urlMatch[0] : inputUrl;

  let finalUrl = targetUrl;
  let lat: number | null = null;
  let lng: number | null = null;

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    finalUrl = response.url || targetUrl;
  } catch (err) {
    console.warn('[LOCATION RESOLVER] Error siguiendo redirección HTTP:', err);
  }

  const coords = extractCoordinatesFromMapsUrl(finalUrl) || extractCoordinatesFromMapsUrl(targetUrl);
  if (coords) {
    lat = coords.lat;
    lng = coords.lng;
    finalUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  }

  return {
    resolvedUrl: finalUrl,
    lat,
    lng,
    formattedAddress: coords ? `Coordenadas: ${lat}, ${lng}` : null,
    isNativeLocation: false
  };
}

/**
 * Función principal que detecta si el texto o payload contiene una ubicación y la resuelve por completo
 */
export async function processLocationInput(textOrLocationObj: any): Promise<LocationResult | null> {
  if (!textOrLocationObj) return null;

  // Caso 1: Ubicación nativa de WhatsApp
  if (typeof textOrLocationObj === 'object' && textOrLocationObj.latitude) {
    return resolveWhatsAppNativeLocation(textOrLocationObj);
  }

  // Caso 2: Texto que contiene enlace de Google Maps
  if (typeof textOrLocationObj === 'string') {
    const hasMapsUrl = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.com\/maps|maps\.google\.[a-z.]+|[a-z0-9\-]+\.google\.[a-z.]+\/maps)\S*/i.test(textOrLocationObj);
    if (hasMapsUrl) {
      return await resolveGoogleMapsUrl(textOrLocationObj);
    }
  }

  return null;
}
