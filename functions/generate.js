export async function onRequestPost(context) {
  const { REPLICATE_API_TOKEN } = context.env;
  const body = await context.request.json();
  const prompt = body.prompt;

  const PART_DURATION = 10; // segundos
  const TOTAL_DURATION = 180; // 3 minutos
  const PARTS = TOTAL_DURATION / PART_DURATION;

  let jobs = [];

  for (let i = 0; i < PARTS; i++) {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "your-model-version-id-here",
        input: {
          prompt: prompt,
          duration: PART_DURATION
        }
      })
    });

    const prediction = await response.json();
    jobs.push(prediction.id);
  }

  return Response.json({ jobs });
}
