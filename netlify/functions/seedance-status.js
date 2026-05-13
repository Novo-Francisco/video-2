// Netlify Function: proxy seguro para Seedance status

export async function handler(event) {
  try {
    const baseUrl = (process.env.SEEDANCE_API_BASE_URL || '').replace(/\/$/, '');
    const apiKey = process.env.SEEDANCE_API_KEY;
    if (!baseUrl || !apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Config ausente no servidor (SEEDANCE_API_BASE_URL/SEEDANCE_API_KEY).' }) };
    }

    const taskId = event.queryStringParameters?.task_id;
    if (!taskId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'task_id obrigatório' }) };
    }

    const url = new URL(`${baseUrl}/status`);
    url.searchParams.set('task_id', taskId);

    const resp = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await resp.json().catch(() => ({}));

    return {
      statusCode: resp.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resp.ok ? data : { error: data?.error || data?.message || 'Seedance status falhou', details: data })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) };
  }
}
