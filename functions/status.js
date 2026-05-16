export async function onRequestPost(context) {
  const { REPLICATE_API_TOKEN } = context.env;

  if (!REPLICATE_API_TOKEN) {
    return Response.json({ error: "REPLICATE_API_TOKEN não configurado." }, { status: 500 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Body inválido. Envie JSON com { jobs: [...] }." }, { status: 400 });
  }

  const jobs = body?.jobs;

  if (!Array.isArray(jobs) || jobs.length === 0) {
    return Response.json({ error: "Envie um array jobs: ['id1','id2']" }, { status: 400 });
  }

  // Status do Replicate (terminais e em andamento) [1](https://replicate.com/docs/topics/predictions/lifecycle)
  const TERMINAL = new Set(["succeeded", "failed", "canceled", "aborted"]);

  const results = [];
  let allTerminal = true;
  let anyFailed = false;
  const outputs = [];

  for (const id of jobs) {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    const prediction = await response.json().catch(() => ({}));

    if (!response.ok) {
      allTerminal = false;
      anyFailed = true;
      results.push({
        id,
        status: "failed",
        error: prediction?.detail || `Falha ao consultar prediction (HTTP ${response.status})`
      });
      continue;
    }

    const status = prediction.status || "unknown";

    // terminal?
    if (!TERMINAL.has(status)) {
      allTerminal = false;
    }

    // falha?
    if (status === "failed" || status === "canceled" || status === "aborted") {
      anyFailed = true;
    }

    // output (quando succeeded)
    let outUrl = null;
    if (status === "succeeded") {
      // Muitos modelos retornam output como array de URLs
      if (Array.isArray(prediction.output)) outUrl = prediction.output[0] ?? null;
      else if (typeof prediction.output === "string") outUrl = prediction.output;
      if (outUrl) outputs.push(outUrl);
    }

    results.push({
      id,
      status,
      output: outUrl,
      error: prediction.error ?? null
    });
  }

  // done = tudo terminou E não teve falha
  const done = allTerminal && !anyFailed;

  return Response.json({
    done,
    anyFailed,
    allTerminal,
    outputs,  // compatível com seu app.js mesmo no modo simples
    results   // modo detalhado (recomendado)
  });
}
