/*
  App 100% web: gera segmentos via Functions e concatena no navegador.
  IMPORTANTE: a API key não fica aqui (fica em variáveis da Function).
*/

const $ = (id) => document.getElementById(id);
const scenesEl = $('scenes');
const totalEl = $('total');
const logEl = $('log');
const errEl = $('err');
const btnRender = $('btnRender');
const btnAdd = $('btnAdd');
const downloadA = $('download');

const DEFAULT_IMAGE = 'https://example.com/sua-imagem.jpg';

let scenes = [
  {
    title: 'Cena 1 (PT-BR)',
    durationSec: 10,
    aspectRatio: '9:16',
    model: 'seedance-2.0',
    imageUrl: DEFAULT_IMAGE,
    voiceDirection: 'A deep, calm male voice',
    dialogue: 'Olá! Bem-vindo ao nosso vídeo.',
    sceneAction: 'A cinematic close-up, gentle camera push-in, warm lighting, subtle motion in hair and fabric.',
    musicDirection: 'soft ambient instrumental, subtle, not overpowering',
    subtitles: true
  },
  {
    title: 'Cena 2 (EN)',
    durationSec: 10,
    aspectRatio: '9:16',
    model: 'seedance-2.0',
    imageUrl: DEFAULT_IMAGE,
    voiceDirection: 'A bright, energetic female voice',
    dialogue: "Let's go! Here's what you'll see next.",
    sceneAction: 'Wide shot, slow pan left, cinematic contrast, natural motion, keep the subject consistent.',
    musicDirection: 'uplifting light electronic bed, minimal',
    subtitles: true
  }
];

function buildPrompt(s) {
  const parts = [];
  if (s.dialogue && s.dialogue.trim()) {
    parts.push(`Generate a video with voiceover. ${s.voiceDirection || 'A natural voice'} says: "${s.dialogue.trim()}".`);
  }
  if (s.subtitles && s.dialogue && s.dialogue.trim()) {
    parts.push('Subtitles appear at the bottom matching the dialogue.');
  }
  if (s.musicDirection && s.musicDirection.trim()) {
    parts.push(`Background audio mood: ${s.musicDirection.trim()}.`);
  }
  if (s.sceneAction && s.sceneAction.trim()) {
    parts.push(s.sceneAction.trim());
  }
  parts.push('Preserve the look and style of the reference image while adding natural motion.');
  return parts.join(' ');
}

function totalSeconds() {
  return scenes.reduce((a, s) => a + Number(s.durationSec || 0), 0);
}

function setError(msg) {
  errEl.style.display = msg ? 'block' : 'none';
  errEl.textContent = msg || '';
}

function log(msg) {
  logEl.textContent += `
${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
}

function renderScenesUI() {
  scenesEl.innerHTML = '';
  const total = totalSeconds();
  totalEl.textContent = `${total}s`;
  totalEl.className = total > 180 ? 'bad' : 'good';

  scenes.forEach((s, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'scene';

    wrap.innerHTML = `
      <div class="sceneHeader">
        <div class="sceneTitle"><input class="input" data-k="title" value="${escapeHtml(s.title)}" /></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <select class="input" style="width:150px" data-k="durationSec">
            <option value="5">5s</option>
            <option value="10">10s</option>
            <option value="15">15s</option>
          </select>
          <select class="input" style="width:150px" data-k="aspectRatio">
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
            <option value="3:4">3:4</option>
          </select>
          <select class="input" style="width:180px" data-k="model">
            <option value="seedance-2.0">seedance-2.0</option>
            <option value="seedance-2.0-fast">seedance-2.0-fast</option>
          </select>
          <button class="btn btnGhost" data-action="remove">Remover</button>
        </div>
      </div>

      <div class="label">Imagem (URL pública https)</div>
      <input class="input" data-k="imageUrl" value="${escapeHtml(s.imageUrl)}" />

      <div class="row3" style="margin-top:10px">
        <div>
          <div class="label">Direção de voz</div>
          <input class="input" data-k="voiceDirection" value="${escapeHtml(s.voiceDirection || '')}" placeholder="A deep, calm male voice" />
        </div>
        <div>
          <div class="label">Diálogo/locução (no idioma desejado)</div>
          <textarea class="input ta" data-k="dialogue">${escapeHtml(s.dialogue || '')}</textarea>
          <label style="display:flex;gap:8px;align-items:center;margin-top:8px">
            <input type="checkbox" data-k="subtitles" ${s.subtitles ? 'checked' : ''} />
            <span class="small">Gerar legendas (via prompt)</span>
          </label>
        </div>
        <div>
          <div class="label">Ação/câmera/estilo</div>
          <textarea class="input ta" data-k="sceneAction" placeholder="Cinematic close-up, slow dolly in...">${escapeHtml(s.sceneAction || '')}</textarea>
          <div class="label">Trilha (direção)</div>
          <input class="input" data-k="musicDirection" value="${escapeHtml(s.musicDirection || '')}" placeholder="soft ambient instrumental" />
        </div>
      </div>

      <div class="label">Prompt gerado (enviado)</div>
      <textarea class="input ta" data-k="__prompt" readonly>${escapeHtml(buildPrompt(s))}</textarea>
    `;

    // set selects
    wrap.querySelector('[data-k="durationSec"]').value = String(s.durationSec);
    wrap.querySelector('[data-k="aspectRatio"]').value = s.aspectRatio;
    wrap.querySelector('[data-k="model"]').value = s.model;

    wrap.addEventListener('input', (ev) => {
      const t = ev.target;
      if (!t || !t.getAttribute) return;
      const k = t.getAttribute('data-k');
      if (!k || k === '__prompt') return;
      if (k === 'subtitles') {
        s.subtitles = t.checked;
      } else if (k === 'durationSec') {
        s.durationSec = Number(t.value);
      } else {
        s[k] = t.value;
      }
      wrap.querySelector('[data-k="__prompt"]').value = buildPrompt(s);
      renderScenesUI();
    });

    wrap.querySelector('[data-action="remove"]').addEventListener('click', () => {
      scenes.splice(i, 1);
      renderScenesUI();
    });

    scenesEl.appendChild(wrap);
  });
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));
}

btnAdd.addEventListener('click', () => {
  scenes.push({
    title: `Cena ${scenes.length + 1}`,
    durationSec: 10,
    aspectRatio: '9:16',
    model: 'seedance-2.0',
    imageUrl: scenes[0]?.imageUrl || DEFAULT_IMAGE,
    voiceDirection: 'A natural voice',
    dialogue: '',
    sceneAction: '',
    musicDirection: '',
    subtitles: false
  });
  renderScenesUI();
});

async function seedanceGenerate(scene) {
  const payload = {
    prompt: buildPrompt(scene),
    duration: scene.durationSec,
    aspect_ratio: scene.aspectRatio,
    images: [scene.imageUrl],
    model: scene.model
  };
  const res = await fetch('/.netlify/functions/seedance-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'generate falhou');
  return data;
}

async function seedanceStatus(taskId) {
  const url = new URL('/.netlify/functions/seedance-status', window.location.origin);
  url.searchParams.set('task_id', taskId);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'status falhou');
  return data;
}

function pick(obj, paths) {
  for (const p of paths) {
    const parts = p.split('.');
    let cur = obj;
    let ok = true;
    for (const part of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, part)) cur = cur[part];
      else { ok = false; break; }
    }
    if (ok && cur != null) return cur;
  }
  return null;
}

async function generateAll() {
  setError('');
  downloadA.style.display = 'none';
  downloadA.removeAttribute('href');

  const total = totalSeconds();
  if (total > 180) {
    setError(`Seu roteiro tem ${total}s. O limite aqui é 180s.`);
    return;
  }

  btnRender.disabled = true;
  logEl.textContent = 'Iniciando…';

  const segmentUrls = [];

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    log(`
[Cena ${i+1}/${scenes.length}] Enviando para geração…`);
    const gen = await seedanceGenerate(s);
    const taskId = pick(gen, ['data.task_id', 'task_id', 'data.taskId', 'taskId']);
    if (!taskId) throw new Error('Sem task_id na resposta de generate.');
    log(`[Cena ${i+1}] task_id: ${taskId}`);

    let videoUrl = null;
    for (let t = 0; t < 200; t++) {
      const st = await seedanceStatus(taskId);
      const status = String(pick(st, ['data.status','status','data.state','state']) || '').toLowerCase();
      videoUrl = pick(st, ['data.video_url','data.videoUrl','data.result.video','result.video','data.video.url','video_url','videoUrl']);
      if (videoUrl && (status.includes('success') || status.includes('succeed') || status === 'completed')) break;
      if (status.includes('fail')) throw new Error(`Cena ${i+1} falhou.`);
      await new Promise(r => setTimeout(r, 3000));
      if (t % 5 === 0) log(`[Cena ${i+1}] aguardando… (${t})`);
    }
    if (!videoUrl) throw new Error(`Timeout: Cena ${i+1} sem URL.`);
    log(`[Cena ${i+1}] OK: ${videoUrl}`);
    segmentUrls.push(videoUrl);
  }

  log('
Baixando segmentos para montar o MP4 final no navegador…');
  const finalBlob = await concatInBrowser(segmentUrls);
  const finalUrl = URL.createObjectURL(finalBlob);
  downloadA.href = finalUrl;
  downloadA.style.display = 'inline-block';
  log('
Pronto! Clique em “Baixar vídeo final”.');

  btnRender.disabled = false;
}

async function concatInBrowser(segmentUrls) {
  // Usa ffmpeg.wasm. Isso pode ser pesado dependendo do tamanho.
  const { createFFmpeg, fetchFile } = FFmpeg;
  const ffmpeg = createFFmpeg({ log: true });
  await ffmpeg.load();

  // baixa e escreve os arquivos
  const listLines = [];
  for (let i = 0; i < segmentUrls.length; i++) {
    const u = segmentUrls[i];
    const name = `seg_${String(i).padStart(3,'0')}.mp4`;
    const resp = await fetch(u);
    const buf = await resp.arrayBuffer();
    ffmpeg.FS('writeFile', name, new Uint8Array(buf));
    listLines.push(`file '${name}'`);
  }
  ffmpeg.FS('writeFile', 'files.txt', new TextEncoder().encode(listLines.join('
') + '
'));

  // concat demuxer com stream copy (funciona se codecs/parâmetros baterem)
  // se falhar, re-encode para h264/aac.
  try {
    await ffmpeg.run('-f','concat','-safe','0','-i','files.txt','-c','copy','final.mp4');
  } catch (e) {
    await ffmpeg.run('-f','concat','-safe','0','-i','files.txt','-c:v','libx264','-crf','23','-c:a','aac','-b:a','192k','final.mp4');
  }

  const out = ffmpeg.FS('readFile', 'final.mp4');
  return new Blob([out.buffer], { type: 'video/mp4' });
}

btnRender.addEventListener('click', () => {
  generateAll().catch((e) => {
    console.error(e);
    setError(String(e.message || e));
    btnRender.disabled = false;
  });
});

renderScenesUI();
