const ENDPOINTS = {
  generate: "/generate",
  status: "/status",
  merge: "/merge",
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 300;
const REQUEST_TIMEOUT_MS = 30000;

const promptEl = document.getElementById("prompt");
const imagesEl = document.getElementById("images");
const btnEl = document.getElementById("generate");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("result");
const downloadBtn = document.getElementById("downloadFinal");

let pollingTimer = null;
let pollCount = 0;
let currentOutputs = [];
let playingIndex = 0;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}

function setStatus(html) {
  if (statusEl) statusEl.innerHTML = html;
}

function disableUI(disabled) {
  if (btnEl) btnEl.disabled = disabled;
  if (promptEl) promptEl.disabled = disabled;
  if (imagesEl) imagesEl.disabled = disabled;
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

function renderDetailedProgress(results) {
  if (!Array.isArray(results)) return renderBasicProgress();

  const rows = results.map((r, idx) => {
    const st = r.status || "desconhecido";
    const icon =
      st === "succeeded" ? "✅" :
      (st === "failed" || st === "canceled" || st === "aborted") ? "❌" :
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
      p.catch(() => setStatus(`✅ Vídeos prontos. Clique em Play no player para começar.`));
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
    body: JSON.stringify({ jobs: jobIds }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Falha ao consultar status (HTTP ${res.status}).`);
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

    const res = await fetchWithTimeout(ENDPOINTS.generate, { method: "POST", body: fd });
    const genData = await res.json().catch(() => ({}));

    if (!res.ok) {
      // ✅ Mostra detalhes do backend se existirem
      const extra = genData?.details ? `\n\nDetalhes:\n${JSON.stringify(genData.details, null, 2)}` : "";
      throw new Error((genData?.error || `Erro ao iniciar geração (HTTP ${res.status}).`) + extra);
    }

    const jobs = genData.jobs || [];
    const jobIds = jobs.map((j) => (typeof j === "string" ? j : j.id)).filter(Boolean);

    setStatus(`🟡 Jobs criados (${jobIds.length}). Processando cenas...`);
    pollCount = 0;

    pollingTimer = setInterval(async () => {
      try {
        pollCount += 1;
        if (pollCount > MAX_POLLS) {
          stopPolling();
          disableUI(false);
          setStatus(`<div style="color:#b00020;">Demorou demais. Tente reduzir o tamanho/quantidade das imagens.</div>`);
          return;
        }

        const stData = await checkStatus(jobIds);

        if (Array.isArray(stData.results)) {
          renderDetailedProgress(stData.results);

          if (stData.anyFailed) {
            stopPolling();
            disableUI(false);
            setStatus(`<div style="color:#b00020;"><strong>Algumas cenas falharam.</strong></div>`);
            return;
          }

          if (stData.done) {
            stopPolling();
            disableUI(false);

            const outputs = stData.results
              .filter((r) => r.status === "succeeded")
              .map((r) => r.output)
              .filter(Boolean);

            setStatus(`✅ Pronto! Reproduzindo cenas em sequência...`);
            playSequence(outputs);
            if (downloadBtn) downloadBtn.disabled = false;
          }
        } else {
          if (stData.done) {
            stopPolling();
            disableUI(false);
            const outputs = Array.isArray(stData.outputs) ? stData.outputs : [];
            setStatus(`✅ Pronto! Reproduzindo cenas em sequência...`);
            playSequence(outputs);
            if (downloadBtn) downloadBtn.disabled = false;
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

if (downloadBtn) {
  downloadBtn.disabled = true;

  downloadBtn.addEventListener("click", async () => {
    if (!currentOutputs || !currentOutputs.length) {
      alert("Nenhum vídeo pronto ainda.");
      return;
    }

    downloadBtn.disabled = true;
    const oldText = downloadBtn.textContent;
    downloadBtn.textContent = "⏳ Montando MP4 final...";

    try {
      const resp = await fetchWithTimeout(ENDPOINTS.merge, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputs: currentOutputs, filename: "video_final.mp4" }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Erro no merge (HTTP ${resp.status})`);
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "video_final.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      downloadBtn.textContent = oldText || "⬇️ Baixar MP4 final";
      downloadBtn.disabled = false;
    } catch (e) {
      alert(`Falhou: ${e.message}`);
      downloadBtn.textContent = oldText || "⬇️ Baixar MP4 final";
      downloadBtn.disabled = false;
    }
  });
}
