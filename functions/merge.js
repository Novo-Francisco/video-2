// functions/merge.js
// "Merge" sem ffmpeg: cria um player HTML que toca os vídeos em sequência.
// POST /merge  -> retorna { playerUrl }
// GET  /merge?p=... -> retorna a página do player

function base64UrlEncode(str) {
  // btoa trabalha com latin1; aqui str é JSON ASCII/UTF-8 simples.
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(b64url) {
  const pad = b64url.length % 4 ? "=".repeat(4 - (b64url.length % 4)) : "";
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const str = decodeURIComponent(escape(atob(b64)));
  return str;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function sanitizeUrlList(outputs) {
  if (!Array.isArray(outputs)) return [];
  return outputs
    .map(String)
    .map(s => s.trim())
    .filter(Boolean)
    // evita payloads estranhos
    .filter(u => /^https?:\/\//i.test(u));
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Body inválido. Envie JSON." }, 400);
  }

  const outputs = sanitizeUrlList(body?.outputs);
  const musicUrl = (body?.musicUrl || "").toString().trim();
  const title = (body?.title || "Player do Vídeo").toString().trim();

  if (!outputs.length) {
    return jsonResponse({ error: "Envie outputs: [urls...] com pelo menos 1 URL válida." }, 400);
  }

  // Monta payload para a página
  const payload = {
    title,
    outputs,
    musicUrl: /^https?:\/\//i.test(musicUrl) ? musicUrl : "" // só aceita URL http(s)
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  return jsonResponse({
    playerUrl: `/merge?p=${encoded}`,
    count: outputs.length
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const p = url.searchParams.get("p");

  if (!p) {
    // Página "help" simples se abrir /merge sem parâmetro
    return htmlResponse(`
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Merge Player</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;max-width:900px}
    code{background:#f3f3f3;padding:2px 6px;border-radius:6px}
  </style>
</head>
<body>
  <h1>Merge Player</h1>
  <p>Use <code>POST /merge</code> com JSON: <code>{"outputs":["https://...mp4"], "musicUrl":"https://...mp3"}</code>.</p>
  <p>Ele retorna um <code>playerUrl</code>. Abra esse link para tocar tudo em sequência.</p>
</body>
</html>`);
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(p));
  } catch {
    return htmlResponse("<h1>Payload inválido</h1>", 400);
  }

  const title = (payload?.title || "Player do Vídeo").toString();
  const outputs = sanitizeUrlList(payload?.outputs);
  const musicUrl = (payload?.musicUrl || "").toString().trim();
  const safeMusicUrl = /^https?:\/\//i.test(musicUrl) ? musicUrl : "";

  if (!outputs.length) {
    return htmlResponse("<h1>Sem vídeos para reproduzir</h1>", 400);
  }

  // HTML do player
  return htmlResponse(`
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title.replace(/</g, "&lt;")}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:20px;max-width:980px}
    h1{font-size:20px;margin:0 0 10px}
    .card{border:1px solid rgba(0,0,0,.12);border-radius:14px;padding:14px}
    video{width:100%;max-height:70vh;background:#000;border-radius:12px}
    .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px}
    button{border:0;border-radius:12px;padding:10px 14px;background:#2563eb;color:#fff;cursor:pointer}
    button:disabled{opacity:.6;cursor:not-allowed}
    .muted{opacity:.75;font-size:13px}
    .list{margin-top:10px;font-size:13px}
    a{word-break:break-all}
    .status{margin-top:10px}
  </style>
</head>
<body>
  <h1>${title.replace(/</g, "&lt;")}</h1>

  <div class="card">
    <video id="player" controls playsinline></video>

    <div class="row">
      <button id="startBtn">▶ Reproduzir sequência</button>
      <button id="restartBtn" disabled>↩ Recomeçar</button>
      ${safeMusicUrl ? `<span class="muted">🎵 Música: ligada</span>` : `<span class="muted">🎵 Música: (nenhuma)</span>`}
      <span class="muted">Cenas: ${outputs.length}</span>
    </div>

    <div class="status" id="status"></div>

    <div class="list">
      <details>
        <summary>Ver URLs das cenas</summary>
        <ol>
          ${outputs.map(u => `<li><a href="${u}" target="_blank" rel="noopener">${u}</a></li>`).join("")}
        </ol>
      </details>
    </div>
  </div>

  ${safeMusicUrl ? `<audio id="bgm" src="${safeMusicUrl}" loop></audio>` : ""}

<script>
(() => {
  const outputs = ${JSON.stringify(outputs)};
  const player = document.getElementById("player");
  const startBtn = document.getElementById("startBtn");
  const restartBtn = document.getElementById("restartBtn");
  const statusEl = document.getElementById("status");
  const bgm = document.getElementById("bgm");

  let idx = 0;
  let started = false;

  function setStatus(html){ statusEl.innerHTML = html; }

  function playAt(i) {
    if (i >= outputs.length) {
      setStatus("✅ Finalizado. Todas as cenas foram reproduzidas.");
      restartBtn.disabled = false;
      return;
    }
    idx = i;
    setStatus("🎬 Reproduzindo cena " + (idx+1) + " de " + outputs.length + "...");
    player.src = outputs[idx];
    player.load();
    const p = player.play();
    if (p && p.catch) {
      p.catch(() => {
        setStatus("Clique em Play no vídeo para iniciar (autoplay bloqueado).");
      });
    }
  }

  player.addEventListener("ended", () => {
    playAt(idx + 1);
  });

  function start() {
    if (started) return;
    started = true;
    startBtn.disabled = true;
    restartBtn.disabled = false;

    // Tenta iniciar música junto (pode exigir gesto do usuário por políticas do navegador)
    if (bgm) {
      const ap = bgm.play();
      if (ap && ap.catch) ap.catch(() => {});
      bgm.volume = 0.35;
    }

    playAt(0);
  }

  function restart() {
    started = false;
    startBtn.disabled = false;
    idx = 0;
    setStatus("↩ Pronto para recomeçar.");
    if (bgm) { bgm.currentTime = 0; }
  }

  startBtn.addEventListener("click", start);
  restartBtn.addEventListener("click", () => {
    restart();
    start();
  });

  setStatus("Pronto. Clique em <strong>Reproduzir sequência</strong>.");
})();
</script>
</body>
</html>
`, 200);
}
