export async function onRequest(context) {
  const apiKey = context.env.SEEDANCE_API_KEY;
  const baseUrl = context.env.SEEDANCE_API_BASE_URL;

  if (!apiKey || !baseUrl) {
    return new Response(
      JSON.stringify({
        error: "SEEDANCE_API_KEY ou SEEDANCE_API_BASE_URL não configurada"
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  let requestBody;
  try {
    requestBody = await context.request.json();
  } catch {
    requestBody = {};
  }

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
}

