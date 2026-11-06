export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Notion-Version, X-Assistant-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const header = req.headers?.['x-assistant-token'] || req.headers?.authorization || '';
  const assistantToken = String(header).replace(/^Bearer\s+/i, '').trim();
  const expectedAssistantToken = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
  if (!expectedAssistantToken || assistantToken !== expectedAssistantToken) return res.status(401).json({ error: 'No autorizado' });

  try {
    const { url, method, headers = {}, body } = req.body || {};

    if (!url) return res.status(400).json({ error: 'Falta la URL de Notion' });
    if (!url.startsWith('https://api.notion.com/')) {
      return res.status(400).json({ error: 'URL no permitida' });
    }

    // Token: priorizar el que viene en headers del body, luego env var del servidor
    const token = headers['Authorization'] || headers['authorization'] ||
                  (process.env.NOTION_TOKEN ? `Bearer ${process.env.NOTION_TOKEN}` : null);

    const forwardHeaders = {
      'Content-Type': 'application/json',
      'Notion-Version': headers['Notion-Version'] || '2022-06-28',
      ...(token ? { 'Authorization': token } : {})
    };

    const response = await fetch(url, {
      method: method || 'GET',
      headers: forwardHeaders,
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    res.status(response.status);
    return data ? res.json(data) : res.send(text);

  } catch (err) {
    console.error('[notion-proxy error]', err);
    return res.status(500).json({ error: err.message });
  }
}
