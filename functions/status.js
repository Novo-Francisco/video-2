export async function onRequest(context) {
const apiKey = context.env.SEEDANCE_API_KEY;
const baseUrl = context.env.SEEDANCE_API_BASE_URL;
if (!apiKey || !baseUrl) {
return new Response(
JSON.stringify({ error: "Variáveis não configuradas" }),
{ status: 500, headers: { "Content-Type": "application/json" } }
);
}
try {
const response = await fetch(baseUrl + "/status", {
method: "GET",
headers: {
"Authorization": "Bearer " + apiKey
}
});
const data = await response.text();

return new Response(data, {
  status: response.status,
  headers: { "Content-Type": "application/json" }
});

} catch (err) {
return new Response(
JSON.stringify({ error: String(err) }),
{ status: 500 }
);
}
}
