const alertTest = "JS carregou ✅";
console.log(alertTest);
const btnRender = document.getElementById("btnRender");
const btnAdd = document.getElementById("btnAdd");
btnAdd.addEventListener("click", () => {
console.log("Clique em + Nova cena");
alert("Botão funcionando ✅");
});
btnRender.addEventListener("click", () => {
console.log("Clique em gerar");
alert("Gerar funcionando ✅");
});
