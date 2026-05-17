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

// --- Health check ---
app.get("/health", (req, res) => res.json({ ok: true }));

// --- Multer para receber multipart/form-data ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB por imagem
});

// ============================
// Replicate config
// ============================

function getToken(res) {
  const token = (process.env.REPLICATE_API_TOKEN || "").trim();
  if (!token) {
    res.status(500).json({ error: "REPLICATE_API_TOKEN não configurado no Railway (Variables)." });
    return null;
  }
  return token;
}

// ✅ Seedance 2.0 (bytedance/seedance-2.0) versão/hash conhecida no Replicate: [5](https://metacpan.org/)
const DEFAULT_SEEDANCE_VERSION =
  "3bc3d0e67e2af136924e33fca5a827c2b3a8e09aeff8fa462bc7540ebfa2521d";

function getModelVersion() {
  // Você pode sobrescrever no Railway (Variables):
  // REPLICATE_VERSION = <hash>
  return (process.env.REPLICATE_VERSION || "").trim() || DEFAULT_SEEDANCE_VERSION;
}

// ============================
// /generate: prompt + imagens -> jobs
// ============================
app.post("/generate", upload.array("images"), async (req, res) => {
  const token = getToken(res);
  if (!token) return;

  const prompt = (req.body?.prompt || "").toString().trim();
  const files = req.files || [];

  if (!prompt) return res.status(400).json({ error: "Prompt não enviado." });
  if (!files.length) return res.status(400).json({ error: "Nenhuma imagem enviada." });

  const version = getModelVersion();

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
    const results = await mapLimit(files, 2, async (file, idx) => {
      const base64 = Buffer.from(file.buffer).toString("base64");

      // ⚠️ IMPORTANTE:
      // O Replicate espera "version" como ID/hash da versão do modelo. [2](https://dev.to/c_jordi_666570f401c202c50/dont-make-users-click-100-times-how-to-package-and-download-multiple-files-in-javascript-2ben)[3](https://www.xjavascript.com/blog/how-can-i-let-a-user-download-multiple-files-when-a-button-is-clicked/)
      // Seedance 2.0 aceita multimodal (texto+imagem etc.), mas os nomes exatos dos campos podem variar por modelo.
      // Se algum campo estiver diferente, o "raw" abaixo vai te mostrar o erro exato.

      const body = {
        version,
        input: {
          prompt,
          // imagem como data URI
          image: `data:${file.mimetype};base64,${base64}`,
          // duração padrão 5s (você pode mudar depois)
          duration: 5,
        },
      };

      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          // Replicate documenta Bearer token no header Authorization. [1](https://docs.rs/replicate-client/latest/replicate_client/models/prediction/enum.PredictionStatus.html)
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          // Sync mode: tenta esperar até ~60s, senão volta starting/processing. [2](https://dev.to/c_jordi_666570f401c202c50/dont-make-users-click-100-times-how-to-package-and-download-multiple-files-in-javascript-2ben)
          Prefer: "wait",
        },
        body: JSON.stringify(body),
      });

      const prediction = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          ok: false,
          scene: idx + 1,
          error: prediction?.detail || prediction?.error || `HTTP ${response.status}`,
          raw: prediction,
          sent: { version, inputKeys: Object.keys(body.input) },
        };
      }

      return { ok: true, id: prediction.id, status: prediction.status, scene: idx + 1 };
    });

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      return res.status(502).json({
        error: "Falha ao iniciar uma ou mais cenas.",
        details: failed,
        hint:
          "Se o erro mencionar 'Invalid version', configure REPLICATE_VERSION com a versão correta. Se mencionar campo inválido, ajuste os nomes dos inputs conforme a API do modelo.",
      });
    }

    return res.json({ jobs: results.map((r) => ({ id: r.id, status: r.status })) });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Erro inesperado no /generate" });
  }
});

// ============================
// /status: jobs -> progresso + outputs
// ============================
app.post("/status", async (req, res) => {
  const token = getToken(res);
  if (!token) return;

  const jobs = req.body?.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return res.status(400).json({ error: "Envie JSON { jobs: ['id1','id2',...] }" });
  }

  // Status conforme lifecycle do Replicate. [4](https://www.google.com/)
  const TERMINAL = new Set(["succeeded", "failed", "canceled", "aborted"]);

  let allTerminal = true;
  let anyFailed = false;
  const results = [];
  const outputs = [];

  for (const id of jobs) {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${token}` }, // [1](https://docs.rs/replicate-client/latest/replicate_client/models/prediction/enum.PredictionStatus.html)
    });

    const prediction = await response.json().catch(() => ({}));

    if (!response.ok) {
      allTerminal = false;
      anyFailed = true;
      results.push({
        id,
        status: "failed",
        error: prediction?.detail || prediction?.error || `HTTP ${response.status}`,
        raw: prediction,
      });
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

    results.push({
      id,
      status,
      output: outUrl,
      error: prediction.error ?? null,
    });
  }

  const done = allTerminal && !anyFailed;
  return res.json({ done, anyFailed, allTerminal, outputs, results });
});

// ============================
// FFmpeg merge: /merge (MP4 final real)
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
    p.stderr.on("data", (d) => (stderr += d.toString()));
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
    const localFiles = [];
    for (let i = 0; i < outputs.length; i++) {
      const url = String(outputs[i]).trim();
      if (!/^https?:\/\//i.test(url)) throw new Error(`URL inválida: ${url}`);

      const localPath = path.join(clipsDir, `clip_${String(i + 1).padStart(3, "0")}.mp4`);
      await downloadToFile(url, localPath);
      localFiles.push(localPath);
    }

    const listPath = path.join(workdir, "list.txt");
    fs.writeFileSync(
      listPath,
      localFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8"
    );

    const outPath = path.join(workdir, "out.mp4");

    let usedFallback = false;
    try {
      // concat demuxer (rápido quando compatível)
      await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath], workdir);
    } catch {
      // fallback re-encode
      usedFallback = true;

      const inputArgs = [];
      for (const f of localFiles) inputArgs.push("-i", f);

      const n = localFiles.length;
      const parts = [];
      for (let i = 0; i < n; i++) parts.push(`[${i}:v]`, `[${i}:a]`);
      const filter = `${parts.join("")}concat=n=${n}:v=1:a=1[v][a]`;

      await runFFmpeg(
        [
          "-y",
          ...inputArgs,
          "-filter_complex",
          filter,
          "-map",
          "[v]",
          "-map",
          "[a]",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "22",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outPath,
        ],
        workdir
      );
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Merge-Mode", usedFallback ? "reencode" : "stream-copy");

    const stream = fs.createReadStream(outPath);
    stream.on("close", () => {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch {}
    });
    stream.pipe(res);
  } catch (e) {
    try {
      fs.rmSync(workdir, { recursive: true, force: true });
    } catch {}
    res.status(500).json({ error: e?.message || "Erro no merge." });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server on port", PORT));
