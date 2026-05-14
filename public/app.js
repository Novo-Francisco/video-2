onst btnRender = document.getElementById("btnRender");
const btnAdd = document.getElementById("btnAdd");
const logEl = document.getElementById("log");
const errEl = document.getElementById("err");
function setLog(msg) {
if (logEl) {
logEl.textContent = msg;
}
}
function setError(msg) {
if (errEl) {
errEl.style.display = msg ? "block" : "none";
errEl.textContent = msg || "";
}
}
btnAdd.addEventListener("click", () => {
alert("Botão funcionando ✅");
});
btnRender.addEventListener("click", async () => {
setError("");
setLog("Chamando /generate...");
try {
const res = await fetch("/generate", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
prompt: "teste",
duration: 5,
aspect_ratio: "9:16",
images: ["https://example.com/teste.jpg"],
model: "seedance-2.0"
})
});
const text = await res.text();
setLog("Resposta recebida");
console.log("STATUS:", res.status);
console.log("BODY:", text);

if (!res.ok) {
  setError("Erro da Function/API: " + text);
  return;
}

alert("A chamada para /generate funcionou ✅");

} catch (e) {
console.error(e);
setError("Erro ao chamar /generate: " + String(e));
}
});
