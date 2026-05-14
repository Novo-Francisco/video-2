```js
export async function onRequestPost(context) {
  const token = context.env.REPLICATE_API_TOKEN;

  if (!token) {
    return new Response(
      JSON.stringify({ error: "Token da Replicate não configurado" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "JSON inválido" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const prompt = body.prompt;
  if (!prompt) {
    return new Response(
      JSON.stringify({ error: "Prompt vazio" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      version: "3f0457e4615f6d87c94c4d4b6e90eb1c4a9dbb6e3a9e5f8cbb7e7f9f0c6c8c1d", 
      input: {
        prompt: prompt
      }
    })
  });

  const data = await response.json();

  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: { "Content-Type": "application/json" }
  });
}
