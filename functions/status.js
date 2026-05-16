export async function onRequestPost(context) {
  const { REPLICATE_API_TOKEN } = context.env;
  const body = await context.request.json();
  const jobs = body.jobs;

  let outputs = [];
  let allDone = true;

  for (let id of jobs) {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    const prediction = await response.json();

    if (prediction.status !== "succeeded") {
      allDone = false;
    } else {
      outputs.push(prediction.output[0]);
    }
  }

  return Response.json({
    done: allDone,
    outputs
  });
}
