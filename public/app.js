const promptInput = document.getElementById("prompt");
const generateBtn = document.getElementById("generate");
const statusDiv = document.getElementById("status");
const resultVideo = document.getElementById("result");

generateBtn.onclick = async () => {
  statusDiv.innerText = "Criando partes do vídeo...";
  resultVideo.src = "";

  // 1) Envia o prompt para gerar várias partes
  const response = await fetch("/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: promptInput.value })
  });

  const { jobs } = await response.json();

  statusDiv.innerText = "Processando partes...";
  pollParts(jobs);
};

// 2) Polling das partes individuais
async function pollParts(jobs) {
  const interval = setInterval(async () => {
    const response = await fetch("/status", {
      method: "POST",
      body: JSON.stringify({ jobs })
    });

    const data = await response.json();

    if (!data.done) {
      statusDiv.innerText = "Gerando partes do vídeo...";
      return;
    }

    clearInterval(interval);

    statusDiv.innerText = "Juntando vídeo final...";

    // 3) Envia as partes para o merge
    const merge = await fetch("/merge", {
      method: "POST",
      body: JSON.stringify({ urls: data.outputs })
    });

    const mergeJob = await merge.json();

    // 4) Polling do merge
    pollMerge(mergeJob.id);
  }, 3000);
}

// 5) Polling do job de merge na Replicate
async function pollMerge(id) {
  const interval = setInterval(async () => {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Token " + (window.REPLICATE_API_TOKEN || "")
      }
    });

    const data = await response.json();

    statusDiv.innerText = "Finalizando vídeo...";

    if (data.status === "succeeded") {
      clearInterval(interval);
      resultVideo.src = data.output[0];
      statusDiv.innerText = "Vídeo final pronto!";
    }

    if (data.status === "failed") {
      clearInterval(interval);
      statusDiv.innerText = "Erro ao juntar o vídeo.";
    }
  }, 3000);
}

