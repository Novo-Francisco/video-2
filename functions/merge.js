export async function onRequestPost(context) {
  const { REPLICATE_API_TOKEN } = context.env;
  const body = await context.request.json();
  const urls = body.urls;

  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      version: "zsxkib/ffmpeg-concat:latest",
      input: {
        videos: urls,
        transition: "none"
      }
    })
  });

  const prediction = await response.json();
  return Response.json(prediction);
}
