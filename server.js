import express from "express";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- Ajuste de caminhos (ESM) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Servir arquivos estáticos do seu site ---
app.use(express.static(path.join(__dirname, "public")));

// --- Health check (agora vai aparecer JSON, não “página em branco”) ---
app.get("/health", (req, res) => res.json({ ok: true }));

// --- Multer para receber multipart/form-data (imagens do <input type=file>) ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB por imagem
});

// ============================
// REPlicate: /generate e /status
// ============================
function requireToken(req, res) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    res.status(500).json({ error: "REPLICATE_API_TOKEN não configurado no Railway (Variables)." });
    return null;
  }
  return token;
}

// /generate: recebe prompt + várias imagens, cria um job por imagem
app.post("/generate", upload.array("images"), async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return;

  const prompt = (req.body?.prompt || "").toString().trim();
  const files = req.files || [];

  if (!prompt) return res.status(400).json({ error: "Prompt não enviado." });
  if (!files.length) return res.status(400).json({ error: "Nenhuma imagem enviada." });

  // Modelo (mantenha o seu)
  const MODEL_VERSION = "zsxkib/img-to-video:latest";

  // Limitador simples de concorrência
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    async function worker() {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  try {
    const results = await mapLimit(files, 2, async (file) => {
      const base64 = Buffer.from(file.buffer).toString("base64");
      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
          // Sync mode tenta esperar até ~60s; se não der, retorna starting/processing e você faz polling.
          Prefer: "wait",
        },
        body: JSON.stringify({
          version: MODEL_VERSION,
          input: {
            prompt,
            image: `data:${file.mimetype};base64,${base64}`,
            duration: 5,
          },
        }),
      });

      const prediction = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, error: prediction?.detail || prediction?.error || `HTTP ${response.status}`, raw: prediction };
      }
      return { ok: true, id: prediction.id, status: prediction.status };
    });

    const failed = results.filter(r => !r.ok);
    if (failed.length) {
      return res.status(502).json({ error: "Falha ao iniciar uma ou mais cenas.", details: failed });
    }

    return res.json({ jobs: results.map(r => ({ id: r.id, status: r.status })) });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Erro inesperado no /generate" });
  }
});

// /status: recebe { jobs: [id...] } e devolve progresso + outputs
app.post("/status", async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return;

  const jobs = req.body?.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return res.status(400).json({ error: "Envie JSON { jobs: ['id1','id2',...] }" });
  }

  // Status terminais do Replicate incluem succeeded/failed/canceled/aborted. [1](https://www.mpegflow.com/recipes/concatenate-video-files)
  const TERMINAL = new Set(["succeeded", "failed", "canceled", "aborted"]);

  let allTerminal = true;
  let anyFailed = false;
  const results = [];
  const outputs = [];

  for (const id of jobs) {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Token ${token}` },
    });

    const prediction = await response.json().catch(() => ({}));
    if (!response.ok) {
      allTerminal = false;
      anyFailed = true;
      results.push({ id, status: "failed", error: prediction?.detail || `HTTP ${response.status}` });
      continue;
    }

    const status = prediction.status || "unknown";
    if (!TERMINAL.has(status)) allTerminal = false;
    if (status === "failed" || status === "canceled" || status === "aborted") anyFailed = true;

    let outUrl = null;
    if (status === "succeeded") {
      if (Array.isArray(prediction.output)) outUrl = prediction.output[0] ?? null;
      else if (typeof prediction.output === "string") outUrl = prediction.output;
      if (outUrl) outputs.push(outUrl);
    }

    results.push({ id, status, output: outUrl, error: prediction.error ?? null });
  }

  // done só quando tudo terminou E sem falha
  const done = allTerminal && !anyFailed;

  return res.json({ done, anyFailed, allTerminal, outputs, results });
});

// ============================
// FFmpeg merge: /merge  (MP4 final real)
// ============================
async function downloadToFile(url, destPath, maxBytes = 250 * 1024 * 1024) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao baixar ${url} (HTTP ${r.status})`);

  const out = fs.createWriteStream(destPath);
  let downloaded = 0;

  return new Promise((resolve, reject) => {
    r.body.on("data", (chunk) => {
      downloaded += chunk.length;
      if (downloaded > maxBytes) {
        r.body.destroy(new Error(`Arquivo excedeu limite (${maxBytes} bytes)`));
      }
    });
    r.body.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
    r.body.pipe(out);
  });
}

function runFFmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { cwd });
    let stderr = "";
    p.stderr.on("data", d => (stderr += d.toString()));
    p.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg code=${code}\n${stderr}`));
    });
  });
}

app.post("/merge", async (req, res) => {
  const outputs = req.body?.outputs;
  const filename = (req.body?.filename || "video_final.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");

  if (!Array.isArray(outputs) || outputs.length < 1) {
    return res.status(400).json({ error: "Envie { outputs: [url1, url2, ...] }" });
  }

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-"));
  const clipsDir = path.join(workdir, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });

  try {
    // baixar clipes
    const localFiles = [];
    for (let i = 0; i < outputs.length; i++) {
      const url = String(outputs[i]).trim();
      if (!/^https?:\/\//i.test(url)) throw new Error(`URL inválida: ${url}`);

      const localPath = path.join(clipsDir, `clip_${String(i + 1).padStart(3, "0")}.mp4`);
      await downloadToFile(url, localPath);
      localFiles.push(localPath);
    }

    // lista concat demuxer (mais rápido quando compatível) [2](https://replicate.com/docs/topics/predictions/lifecycle)
    const listPath = path.join(workdir, "list.txt");
    fs.writeFileSync(listPath, localFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");

    const outPath = path.join(workdir, "out.mp4");

    // tenta sem re-encode
    let usedFallback = false;
    try {
      await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath], workdir);
    } catch {
      // fallback re-encode quando parâmetros diferem [3](https://sdks.replicate.com/resources/predictions/methods/create/)
      usedFallback = true;

      const inputArgs = [];
      for (const f of localFiles) inputArgs.push("-i", f);

      const n = localFiles.length;
      const parts = [];
      for (let i = 0; i < n; i++) parts.push(`[${i}:v]`, `[${i}:a]`);
      const filter = `${parts.join("")}concat=n=${n}:v=1:a=1[v][a]`;

      await runFFmpeg([
        "-y",
        ...inputArgs,
        "-filter_complex", filter,
        "-map", "[v]",
        "-map", "[a]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        outPath
      ], workdir);
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Merge-Mode", usedFallback ? "reencode" : "stream-copy");

    const stream = fs.createReadStream(outPath);
    stream.on("close", () => {
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
    });
    stream.pipe(res);

  } catch (e) {
    try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
    res.status(500).json({ error: e?.message || "Erro no merge." });
  }
});

// Railway usa PORT; padrão 8080
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server on port", PORT));
