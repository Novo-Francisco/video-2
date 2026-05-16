// app.js — pronto para Cloudflare Pages Functions + Replicate
// Ajuste os endpoints se seus arquivos não estiverem em /api/generate e /api/status.
const ENDPOINTS = {
  generate: "/api/generate", // onde está seu generate.js (onRequestPost)
  status: "/api/status"      // onde está seu status.js (onRequestPost)
};

// Configs de polling (não é “tempo”, é frequência de checagem)
const POLL_INTERVAL_MS = 3000;     // checar status a cada 3s
const MAX_POLLS = 300;             // limite de tentativas pra não ficar infinito (ex.: 300 * 3s = 15min)
const REQUEST_TIMEOUT_MS = 30000;  // timeout por request (30s) — só pra chamada HTTP, não pra geração

// Elementos
const promptEl = document.getElementById("prompt");
const imagesEl = document.getElementById("images");
const btnEl = document.getElementById("generate");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("result");

// Estado
let pollingTimer = null;
let pollCount = 0;
let currentJobs = [];
let currentOutputs = [];
let playingIndex = 0;

// Helpers
function setStatus(html) {
  statusEl.innerHTML = html;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}
function disableUI(disabled) {
  btnEl.disabled = disabled;
  promptEl.disabled = disabled;
  imagesEl.disabled = disabled;
}

// fetch com timeout (pra não ficar pendurado em rede)
async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// Renderiza a lista de jobs com status (quando status.js retornar results detalhado)
// Se seu status.js ainda retorna só {done, outputs}, ele ainda funciona,
// mas você vai ver menos detalhes. Eu recomendo atualizar seu status.js como eu sugeri antes.
function renderProgress(results) {
  if (!results || !results.length) {
    setStatus(`<div>Processando cenas...</div>`);
    return;
  }

  const rows = results.map((r, idx) => {
    const st = r.status || "desconhecido";
    const icon =
      st === "succeeded" ? "✅" :
      (st === "failed" || st === "canceled") ? "❌" :
      st === "processing" ? "⏳" :
      st === "starting" ? "🟡" :
      "⏳";
    const err = r.error ? `<div style="color:#b00020;margin-top:4px;">Erro: ${escapeHtml(r.error)}</div>` : "";
    return `
      <div style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,.08)">
        <strong>Cena ${idx + 1}:</strong> ${icon} <span>${escapeHtml(st)}</span>
        ${err}
      </div>
    `;
  }).join("");

  setStatus(`
    <div style="margin-bottom:8px;"><strong>Andamento</strong></div>
    <div>${rows}</div>
    <div style="margin-top:10px;font-size:12px;opacity:.8;">Checagens: ${pollCount}/${MAX_POLLS}</div>
  `);
}

// Toca vídeos em sequência no mesmo <video>
function playSequence(urls) {
  if (!urls || !urls.length) return;

  currentOutputs = urls.filter(Boolean);
  playingIndex = 0;

  // garante controles e comportamento ok
  videoEl.controls = true;
  videoEl.autoplay = true;

  const playAt = (i) => {
    if (i >= currentOutputs.length) {
      setStatus(`<div>✅ Finalizado! Todas as cenas foram reproduzidas.</div>`);
      return;
    }
    const src = currentOutputs[i];
    videoEl.src = src;
    videoEl.load();

    const p = videoEl.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        // alguns navegadores bloqueiam autoplay; usuário clica play.
        setStatus(`<div>✅ Vídeos prontos. Clique em Play no player para começar.</div>`);
      });
    }
  };

  videoEl.onended = () => {
    playingIndex += 1;
    playAt(playingIndex);
  };

  playAt(playingIndex);
}

// Para polling (se estiver rodando)
function stopPolling() {
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = null;
  pollCount = 0;
}

// Faz POST /api/status com jobs e interpreta retorno
async function checkStatus(jobs) {
  const res = await fetchWithTimeout(ENDPOINTS.status, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs })
  });

  // Mesmo se der erro HTTP, tentar ler JSON pra mostrar mensagem
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    const msg = data?.error || `Falha ao consultar status (HTTP ${res.status}).`;
    throw new Error(msg);
  }

  return data;
}

// Ação principal
btnEl.addEventListener("click", async () => {
  stopPolling();
  videoEl.removeAttribute("src");
  videoEl.load();

  const prompt = (promptEl.value || "").trim();
  const files = imagesEl.files;

  if (!prompt) {
    setStatus(`<div style="color:#b00020;">Digite um texto/prompt antes de gerar.</div>`);
    return;
  }
  if (!files || !files.length) {
    setStatus(`<div style="color:#b00020;">Envie pelo menos 1 imagem.</div>`);
    return;
  }

  disableUI(true);
  setStatus(`<div>Enviando texto e fotos...</div>`);

  try {
    // Monta FormData
    const fd = new FormData();
    fd.append("prompt", prompt);
    for (const f of files) fd.append("images", f);

    // Chama generate
    const res = await fetchWithTimeout(ENDPOINTS.generate, {
      method: "POST",
      body: fd
    });

    const genData = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = genData?.error || `Erro ao iniciar geração (HTTP ${res.status}).`;
      throw new Error(msg);
    }

    // Aceita jobs em dois formatos:
    // - [id, id, ...]  (seu generate.js atual)
    // - [{id,status}, ...] (se você melhorar depois)
    let jobs = genData.jobs || [];
    if (!Array.isArray(jobs) || jobs.length === 0) {
      throw new Error("A API não retornou jobs. Verifique generate.js.");
    }

    // Normaliza para array de ids
    const jobIds = jobs.map(j => (typeof j === "string" ? j : j.id)).filter(Boolean);
    currentJobs = jobIds;

    setStatus(`<div>🟡 Jobs criados. Processando cenas...</div>`);
    pollCount = 0;

    // Polling
    pollingTimer = setInterval(async () => {
      try {
        pollCount += 1;

        if (pollCount > MAX_POLLS) {
          stopPolling();
          disableUI(false);
          setStatus(`<div style="color:#b00020;">
            A geração está demorando além do esperado. Você pode tentar novamente ou reduzir o número/tamanho das imagens.
          </div>`);
          return;
        }

        const stData = await checkStatus(jobIds);

        // Formatos aceitos:
        // (A) Seu status.js atual:
        //   { done: boolean, outputs: [url,url...] }
        // (B) Recomendado:
        //   { done: boolean, anyFailed: boolean, results: [{id,status,output,error}...] }
        if (Array.isArray(stData.results)) {
          renderProgress(stData.results);

          if (stData.anyFailed) {
            stopPolling();
            disableUI(false);

            const failed = stData.results.filter(r => r.status === "failed" || r.status === "canceled");
            const details = failed.map((f, i) =>
              `<div>❌ Cena ${stData.results.indexOf(f) + 1}: ${escapeHtml(f.error || "Falhou")}</div>`
            ).join("");

            setStatus(`
              <div style="color:#b00020;"><strong>Algumas cenas falharam.</strong></div>
              <div style="margin-top:8px;">${details || "Veja o console para detalhes."}</div>
              <div style="margin-top:10px;">Dica: tente reduzir o tamanho das imagens ou usar menos cenas.</div>
            `);
            return;
          }

          if (stData.done) {
            stopPolling();
            disableUI(false);

            const outputs = stData.results
              .filter(r => r.status === "succeeded")
              .map(r => r.output)
              .filter(Boolean);

            if (!outputs.length) {
              setStatus(`<div style="color:#b00020;">Concluiu, mas não encontrei URLs de saída.</div>`);
              return;
            }

            setStatus(`<div>✅ Pronto! Reproduzindo cenas em sequência...</div>`);
            playSequence(outputs);
          }
        } else {
          // Formato simples (seu status.js atual)
          if (stData.done) {
            stopPolling();
            disableUI(false);

            const outputs = Array.isArray(stData.outputs) ? stData.outputs : [];
            if (!outputs.length) {
              setStatus(`<div style="color:#b00020;">Concluiu, mas não encontrei outputs.</div>`);
              return;
            }
            setStatus(`<div>✅ Pronto! Reproduzindo cenas em sequência...</div>`);
            playSequence(outputs);
          } else {
            setStatus(`<div>⏳ Processando cenas... (checagem ${pollCount}/${MAX_POLLS})</div>`);
          }
        }
      } catch (e) {
        stopPolling();
        disableUI(false);
        setStatus(`<div style="color:#b00020;">Erro ao checar status: ${escapeHtml(e.message)}</div>`);
      }
    }, POLL_INTERVAL_MS);

  } catch (e) {
    stopPolling();
    disableUI(false);
    setStatus(`<div style="color:#b00020;">${escapeHtml(e.message)}</div>`);
  }
});
