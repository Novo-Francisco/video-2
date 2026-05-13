if (!apiKey) {
  return new Response(
    JSON.stringify({ error: "SEEDANCE_API_KEY não configurada no Cloudflare" }),
    {
      status: 500,
      headers: { "Content-Type": "application/json" }
    }
  );
}

const requestBody = await context.request.json();

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
