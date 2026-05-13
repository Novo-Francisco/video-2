if (!apiKey) {
  return new Response(
    JSON.stringify({ error: "SEEDANCE_API_KEY não configurada no Cloudflare" }),
    {
      status: 500,
      headers: { "Content-Type": "application/json" }
    }
  );
}

if (!taskId) {
  return new Response(
    JSON.stringify({ error: "task_id é obrigatório" }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" }
    }
  );
}

const response = await fetch(baseUrl + "/status?task_id=" + encodeURIComponent(taskId), {
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
