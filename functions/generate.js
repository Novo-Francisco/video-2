export async function onRequestPost({ request, env }) {
  const token = env.REPLICATE_API_TOKEN;

  // 1) Verificações básicas (sempre JSON)
  if (!token) {
    return json({
      ok: false,
      error: "REPLICATE_API_TOKEN não configurado no Cloudflare Pages",
      where: "env"
    }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "JSON inválido ou body vazio",
      where: "request.json"
    }, 400);
  }

  const prompt = (body.prompt || "").trim();
  if (!prompt) {
    return json({
      ok: false,
      error: "Prompt vazio",
      where: "body.prompt"
    }, 400);
  }

  // 2) TESTE DE FUMAÇA (Replicate hello-world) — rápido e confirma que está tudo certo
  // A documentação oficial mostra esse version id como exemplo de previsão. [2](https://replicate.com/docs/topics/predictions/create-a-prediction)[1](https://replicate.com/docs/reference/http)
  const url = "https://api.replicate.com/v1/predictions";
  const payload = {
    version: "5c7d5dc6dd8bf75c1acaa8565735e7986bc5b66206b55cca93cb72c9bf15ccaa",
    input: { text: prompt }
  };

  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        // Faz o request esperar um pouco para tentar já devolver output (ótimo pra teste). [2](https://replicate.com/docs/topics/predictions/create-a-prediction)
        "Prefer": "wait"
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return json({
      ok: false,
      error: "Falha de rede ao chamar Replicate",
      detail: String(e),
      called: url
    }, 502);
  }

  const contentType = upstream.headers.get("content-type") || "";

  // 3) Se NÃO vier JSON, embrulha em JSON (pra você ver o que chegou sem console)
  if (!contentType.toLowerCase().includes("application/json")) {
    const text = await upstream.text();
    return json({
      ok: false,
      error: "Upstream NÃO retornou JSON (veio HTML ou outro tipo)",
      called: url,
      upstream_status: upstream.status,
      upstream_content_type: contentType,
      upstream_body_snippet: text.slice(0, 400)
    }, 502);
  }

  // 4) Se vier JSON, devolve pra página (sem HTML)
  const data = await upstream.json();
  return json({
    ok: upstream.ok,
    provider: "replicate",
    called: url,
    upstream_status: upstream.status,
    data
  }, upstream.status);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
