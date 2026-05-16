// public/app.js — Cloudflare Pages Functions + Replicate
// Rotas conforme sua estrutura: functions/generate.js -> /generate, functions/status.js -> /status
const ENDPOINTS = {
  generate: "/generate",
  status: "/status",
  merge: "/merge" // opcional (não é usado por padrão)
};

const POLL_INTERVAL_MS = 3000;     // checar status a cada 3s
const MAX_POLLS = 300;             // limite de checagens para não ficar infinito
const REQUEST_TIMEOUT_MS = 30000;  // timeout de rede por request

const promptEl = document.getElementById("prompt");
const imagesEl = document.getElementById("images");
const btnEl = document.getElementById("generate");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("result");

let pollingTimer = null;
let pollCount = 0;
let currentJobs = [];
let currentOutputs = [];
let playingIndex = 0;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}
function setStatus(html) {
  statusEl.innerHTML = html;
}
function disableUI(disabled) {
  btnEl.disabled = disabled;
  promptEl.disabled = disabled;
  imagesEl.disabled = disabled;
}

async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function stopPolling() {
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = null;
  pollCount = 0;
}

function renderBasicProgress() {
  setStatus(`⏳ Processando cenas... (checagem ${pollCount}/${MAX_POLLS})`);
}

// Se você atualizar seu status.js para retornar results (recomendado),
// essa UI mostra por cena; se não atualizar, cai no modo básico.
function renderDetailedProgress(results) {
  const rows = results.map((r, idx) => {
    const st = r.status || "desconhecido";
    const icon =
      st === "succeeded" ? "✅" :
      (st === "failed" || st === "canceled") ? "❌" :
      st === "processing" ? "⏳" :
      st === "starting" ? "🟡" :
      "⏳";

    const err = r.error
      ? `<div style="color:#b00020;margin-top:4px;">Erro: ${escapeHtml(r.error)}</div>`
      : "";

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
    <div style="margin-top:10px;font-size:12px;opacity:.8;">
      Checagens: ${pollCount}/${MAX_POLLS}
    </div>
  `);
}

function playSequence(urls) {
  currentOutputs = (urls || []).filter(Boolean);
  playingIndex = 0;

  if (!currentOutputs.length) {
    setStatus(`<div style="color:#b00020;">Nenhum vídeo retornado para reproduzir.</div>`);
    return;
  }

  videoEl.controls = true;
  videoEl.autoplay = true;

  const playAt = (i) => {
    if (i >= currentOutputs.length) {
      setStatus(`✅ Finalizado! Todas as cenas foram reproduzidas.`);
      return;
    }
    const src = currentOutputs[i];
    videoEl.src = src;
    videoEl.load();

    const p = videoEl.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        setStatus(`✅ Vídeos prontos. Clique em Play no player para começar.`);
      });
    }
  };

  videoEl.onended = () => {
    playingIndex += 1;
    playAt(playingIndex);
  };

  playAt(playingIndex);
}

async function checkStatus(jobIds) {
  const res = await fetchWithTimeout(ENDPOINTS.status, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs: jobIds })
  });

  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    throw new Error(data?.error || `Falha ao consultar status (HTTP ${res.status}).`);
  }
  return data;
}

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
  setStatus(`📤 Enviando texto e fotos...`);

  try {
    const fd = new FormData();
    fd.append("prompt", prompt);
    for (const f of files) fd.append("images", f);

    const res = await fetchWithTimeout(ENDPOINTS.generate, {
      method: "POST",
      body: fd
    });

    const genData = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(genData?.error || `Erro ao iniciar geração (HTTP ${res.status}).`);
    }

    let jobs = genData.jobs || [];
    if (!Array.isArray(jobs) || jobs.length === 0) {
      throw new Error("A API não retornou jobs. Verifique o generate.js.");
    }

    // normaliza jobs para array de ids
    const jobIds = jobs.map(j => (typeof j === "string" ? j : j.id)).filter(Boolean);
    currentJobs = jobIds;

    setStatus(`🟡 Jobs criados (${jobIds.length}). Processando cenas...`);
    pollCount = 0;

    pollingTimer = setInterval(async () => {
      try {
        pollCount += 1;

        if (pollCount > MAX_POLLS) {
          stopPolling();
          disableUI(false);
          setStatus(`
            <div style="color:#b00020;">
              A geração está demorando além do esperado. Tente reduzir o número/tamanho das imagens.
            </div>
          `);
          return;
        }

        const stData = await checkStatus(jobIds);

        // Formato (A) — seu status.js atual:
        // { done: boolean, outputs: [url,url...] }
        // Formato (B) — recomendado:
        // { done: boolean, anyFailed: boolean, results: [{id,status,output,error}...] }

        if (Array.isArray(stData.results)) {
          renderDetailedProgress(stData.results);

          if (stData.anyFailed) {
            stopPolling();
            disableUI(false);

            const failed = stData.results.filter(r => r.status === "failed" || r.status === "canceled");
            const details = failed.map(f =>
              `<div>❌ ${escapeHtml(f.id)}: ${escapeHtml(f.error || "Falhou")}</div>`
            ).join("");

            setStatus(`
              <div style="color:#b00020;"><strong>Algumas cenas falharam.</strong></div>
              <div style="margin-top:8px;">${details || "Veja o console para detalhes."}</div>
              <div style="margin-top:10px;">Dica: use menos imagens e/ou imagens menores.</div>
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

            setStatus(`✅ Pronto! Reproduzindo cenas em sequência...`);
            playSequence(outputs);
          }
        } else {
          // formato simples
          if (stData.done) {
            stopPolling();
            disableUI(false);

            const outputs = Array.isArray(stData.outputs) ? stData.outputs : [];
            setStatus(`✅ Pronto! Reproduzindo cenas em sequência...`);
            playSequence(outputs);
          } else {
            renderBasicProgress();
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
