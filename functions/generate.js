export async function onRequestPost(context) {
  const { REPLICATE_API_TOKEN } = context.env;

  if (!REPLICATE_API_TOKEN) {
    return Response.json({ error: "REPLICATE_API_TOKEN não configurado." }, { status: 500 });
  }

  const formData = await context.request.formData();
  const prompt = (formData.get("prompt") || "").toString().trim();
  const images = formData.getAll("images");

  if (!prompt) {
    return Response.json({ error: "Prompt não enviado." }, { status: 400 });
  }

  if (!images || images.length === 0) {
    return Response.json({ error: "Nenhuma imagem enviada." }, { status: 400 });
  }

  // ⚠️ Ajuste aqui se você mudar de modelo.
  // Dica: o endpoint /v1/predictions normalmente usa "version" como ID/hash de versão.
  // Você estava usando "owner/model:latest". Mantive para não quebrar seu fluxo.
  const MODEL_VERSION = "zsxkib/img-to-video:latest";

  // Converte ArrayBuffer -> base64 em chunks (evita travas por spread grande)
  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  // Limitador simples de concorrência (evita estourar memória/CPU em muitos arquivos)
  async function mapLimit(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) break;
        results[i] = await mapper(items[i], i);
      }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  // Faz um prediction por imagem (cena)
  async function createPredictionForFile(file) {
    // Em Pages/Workers, cada item de formData.getAll("images") é um File
    const arrayBuffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);

    const body = {
      version: MODEL_VERSION,
      input: {
        prompt,
        image: `data:${file.type};base64,${base64}`,
        duration: 5
      }
    };

    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        // Sync mode: espera até ~60s pelo resultado (se terminar rápido)
        // Se não terminar, retorna em "starting/processing" e você faz polling no /status
        "Prefer": "wait"
      },
      body: JSON.stringify(body)
    });

    const prediction = await response.json().catch(() => ({}));

    if (!response.ok) {
      // retorna detalhe para você enxergar o erro no front
      const detail = prediction?.detail || prediction?.error || `HTTP ${response.status}`;
      return {
        ok: false,
        error: `Falha ao criar prediction: ${detail}`,
        raw: prediction
      };
    }

    return {
      ok: true,
      id: prediction.id,
      status: prediction.status,
      // em sync mode, alguns modelos podem retornar output já aqui
      output: prediction.output ?? null
    };
  }

  try {
    // Concorrência sugerida: 2 (estável). Pode subir pra 3 se imagens forem pequenas.
    const results = await mapLimit(images, 2, createPredictionForFile);

    const failed = results.filter(r => !r.ok);
    if (failed.length) {
      return Response.json(
        { error: "Uma ou mais cenas falharam ao iniciar.", details: failed },
        { status: 502 }
      );
    }

    // Jobs no formato que o app.js aceita: array de {id,status}
    const jobs = results.map(r => ({ id: r.id, status: r.status }));

    // Se algum output veio pronto (sync), devolve também (opcional)
    const immediateOutputs = results
      .map(r => {
        // Alguns modelos retornam array de outputs, outros string.
        if (!r.output) return null;
        return Array.isArray(r.output) ? r.output[0] : r.output;
      })
      .filter(Boolean);

    return Response.json({
      jobs,
      immediateOutputs
    });
  } catch (e) {
    return Response.json({ error: e?.message || "Erro inesperado no generate.js" }, { status: 500 });
  }
}
