const btnRender = document.getElementById("btnRender");
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
btnAdd.addEventListener("click", function () {
alert("Botão Add funcionando ✅");
});
btnRender.addEventListener("click", async function () {
setError("");
setLog("Chamando /generate...");
try {
const res = await fetch("/api-generate", {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
prompt: "teste simples",
duration: 5,
aspect_ratio: "9:16",
images: ["https://example.com/teste.jpg"],
model: "seedance-2.0"
})
});
const text = await res.text();

console.log("STATUS:", res.status);
console.log("BODY:", text);

setLog("Resposta recebida. Veja o console.");

if (!res.ok) {
  setError("Erro da Function/API: " + text);
  return;
}

alert("Chamada para /generate funcionou ✅");

} catch (e) {
console.error(e);
setError("Erro ao chamar /generate: " + String(e));
}
});
