const promptInput = document.getElementById("prompt");
const generateBtn = document.getElementById("generate");
const statusDiv = document.getElementById("status");
const resultVideo = document.getElementById("result");

generateBtn.onclick = async () => {
  statusDiv.innerText = "Criando partes do vídeo...";

  const response = await fetch("/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: promptInput.value })
  });

  const { jobs } = await response.json();

  pollStatus(jobs);
};

async function pollStatus(jobs) {
  const interval = setInterval(async () => {
    const response = await fetch("/status", {
      method: "POST",
      body: JSON.stringify({ jobs })
    });

    const data = await response.json();

    statusDiv.innerText = "Processando partes...";

    if (data.done) {
      clearInterval(interval);
      statusDiv.innerText = "Juntando vídeo final...";

      const merge = await fetch("/merge", {
        method: "POST",
        body: JSON.stringify({ urls: data.outputs })
      });

      const blob = await merge.blob();
      resultVideo.src = URL.createObjectURL(blob);
      statusDiv.innerText = "Vídeo final pronto!";
    }
  }, 3000);
}
