// Netlify Function: proxy seguro para Seedance generate
// Mantém SEEDANCE_API_KEY fora do browser.

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const baseUrl = (process.env.SEEDANCE_API_BASE_URL || '').replace(/\/$/, '');
    const apiKey = process.env.SEEDANCE_API_KEY;
    if (!baseUrl || !apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Config ausente no servidor (SEEDANCE_API_BASE_URL/SEEDANCE_API_KEY).' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const resp = await fetch(`${baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await resp.json().catch(() => ({}));
    return {
      statusCode: resp.status,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(resp.ok ? data : { error: data?.error || data?.message || 'Seedance generate falhou', details: data })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) };
  }
}
