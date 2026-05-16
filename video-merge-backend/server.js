import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); 
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

// ---- util: baixa arquivo por stream para o disco (Node 20+ fetch) ----
async function downloadToFile(url, destPath, maxBytes = 200 * 1024 * 1024) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar: ${url} (HTTP ${res.status})`);

  const len = Number(res.headers.get("content-length") || "0");
  if (len && len > maxBytes) throw new Error(`Arquivo muito grande (${len} bytes): ${url}`);

  const fileStream = fs.createWriteStream(destPath);
  let downloaded = 0;

  return new Promise((resolve, reject) => {
    res.body.on("data", (chunk) => {
      downloaded += chunk.length;
      if (downloaded > maxBytes) {
        res.body.destroy(new Error(`Arquivo excedeu limite de ${maxBytes} bytes: ${url}`));
      }
    });

    res.body.on("error", reject);
    fileStream.on("error", reject);
    fileStream.on("finish", resolve);

    res.body.pipe(fileStream);
  });
}

// ---- util: roda ffmpeg e captura stderr ----
function runFFmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { cwd });

    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("close", (code) => {
      if (code === 0) resolve({ ok: true, stderr });
      else reject(new Error(`ffmpeg saiu com code=${code}\n${stderr}`));
    });
  });
}

// ---- endpoint principal ----
app.post("/merge", async (req, res) => {
  const outputs = req.body?.outputs;
  const filename = (req.body?.filename || "final.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");

  if (!Array.isArray(outputs) || outputs.length < 1) {
    return res.status(400).json({ error: "Envie JSON { outputs: [url1, url2, ...] }" });
  }
  if (outputs.length > 20) {
    return res.status(400).json({ error: "Limite: até 20 clipes por merge." });
  }

  // pasta temporária por request
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-"));
  const clipsDir = path.join(workdir, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });

  try {
    // 1) baixar todos os clipes
    const localFiles = [];
    for (let i = 0; i < outputs.length; i++) {
      const url = String(outputs[i]).trim();
      if (!/^https?:\/\//i.test(url)) throw new Error(`URL inválida: ${url}`);

      const localPath = path.join(clipsDir, `clip_${String(i + 1).padStart(3, "0")}.mp4`);
      await downloadToFile(url, localPath);
      localFiles.push(localPath);
    }

    // 2) criar list.txt para concat demuxer
    const listPath = path.join(workdir, "list.txt");
    const listContent = localFiles
      .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
      .join("\n");
    fs.writeFileSync(listPath, listContent, "utf8");

    const outPath = path.join(workdir, "out.mp4");

    // 3) tentar merge rápido sem re-encode (concat demuxer)
    // ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4
    // (método oficial recomendado quando os streams batem) [1](https://community.heygen.com/public/forum/boards/troubleshooting/posts/video-generation-via-api-takes-way-to-long-8nxo2jpdzf)
    let usedFallback = false;
    try {
      await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath], workdir);
    } catch (e) {
      // 4) fallback: concat filter com re-encode (funciona quando os clipes diferem) [2](https://github.com/NousResearch/hermes-agent/compare/15c75b101876bd427d6c1dca38212153ce8b98c1...ff8c6f2d64cddbe0dca1006910f1209e6f44bf04.diff)
      usedFallback = true;

      // monta: -i clip1 -i clip2 ... -filter_complex "[0:v][0:a][1:v][1:a]concat=n=N:v=1:a=1[v][a]"
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
          outPath
        ],
        workdir
      );
    }

    // 5) devolver como download
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Merge-Mode", usedFallback ? "reencode" : "stream-copy");

    const stream = fs.createReadStream(outPath);
    stream.on("close", () => {
      // cleanup best-effort
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
    });
    stream.pipe(res);

  } catch (err) {
    try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
    return res.status(500).json({ error: err.message || "Erro no merge." });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Merge backend rodando na porta ${PORT}`);
});
