const fileInput = document.getElementById("images");
const generateBtn = document.getElementById("generate");
const statusDiv = document.getElementById("status");
const resultVideo = document.getElementById("result");

generateBtn.onclick = async () => {
  statusDiv.innerText = "Enviando fotos...";
  resultVideo.src = "";

  const files = fileInput.files;
  if (!files.length) {
    statusDiv.innerText = "Selecione pelo menos uma foto.";
    return;
  }

  const formData = new FormData();
  for (let file of files) {
    formData.append("images", file);
  }

  const response = await fetch("/generate", {
    method: "POST",
    body: formData
  });

  const { jobs } = await response.json();

  statusDiv.innerText = "Gerando vídeos das fotos...";
  pollParts(jobs);
};

async function pollParts(jobs) {
  const interval = setInterval(async () => {
    const response = await fetch("/status", {
      method: "POST",
      body: JSON.stringify({ jobs })
    });

    const data = await response.json();

    if (!data.done) {
      statusDiv.innerText = "Processando cenas...";
      return;
    }

    clearInterval(interval);

    statusDiv.innerText = "Juntando vídeo final...";

    const merge = await fetch("/merge", {
      method: "POST",
      body: JSON.stringify({ urls: data.outputs })
    });

    const mergeJob = await merge.json();

    pollMerge(mergeJob.id);
  }, 3000);
}

async function pollMerge(id) {
  const interval = setInterval(async () => {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: {
        "Content-Type": "application/json"
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
