export async function onRequest(context) {
const apiKey = context.env.SEEDANCE_API_KEY;
const baseUrl = context.env.SEEDANCE_API_BASE_URL;
if (!apiKey || !baseUrl) {
return new Response(
JSON.stringify({ error: "Variáveis não configuradas" }),
{
status: 500,
headers: { "Content-Type": "application/json" }
}
);
}
let requestBody;
try {
requestBody = await context.request.json();
} catch (err) {
return new Response(
JSON.stringify({ error: "JSON inválido ou body vazio" }),
{
status: 400,
headers: { "Content-Type": "application/json" }
}
);
}
try {
const response = await fetch(baseUrl + "/generate", {
method: "POST",
headers: {
"Authorization": "Bearer " + apiKey,
"Content-Type": "application/json"
},
body: JSON.stringify(requestBody)
});
const data = await response.text();

return new Response(data, {
  status: response.status,
  headers: { "Content-Type": "application/json" }
});

} catch (err) {
return new Response(
JSON.stringify({
error: "Erro ao gerar",
detail: String(err)
}),
{
status: 500,
headers: { "Content-Type": "application/json" }
}
);
}
}
