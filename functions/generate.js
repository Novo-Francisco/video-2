export async function onRequestPost(context) {
  const { REPLICATE_API_TOKEN } = context.env;

  const formData = await context.request.formData();
  const images = formData.getAll("images");

  if (!images.length) {
    return Response.json({ error: "Nenhuma imagem enviada." }, { status: 400 });
  }

  let jobs = [];

  for (let file of images) {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "zsxkib/img-to-video:latest",
        input: {
          image: `data:${file.type};base64,${base64}`,
          duration: 5
        }
      })
    });

    const prediction = await response.json();
    jobs.push(prediction.id);
  }

  return Response.json({ jobs });
}
