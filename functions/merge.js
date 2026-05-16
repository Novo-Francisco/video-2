import { ffmpeg } from "@ffmpeg/ffmpeg";

export async function onRequestPost(context) {
  const body = await context.request.json();
  const urls = body.urls;

  await ffmpeg.load();

  let index = 0;
  let list = "";

  for (let url of urls) {
    const file = await fetch(url).then(r => r.arrayBuffer());
    const name = `part${index}.mp4`;

    ffmpeg.FS("writeFile", name, new Uint8Array(file));
    list += `file '${name}'\n`;
    index++;
  }

  ffmpeg.FS("writeFile", "list.txt", new TextEncoder().encode(list));

  await ffmpeg.run("-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "output.mp4");

  const data = ffmpeg.FS("readFile", "output.mp4");

  return new Response(data, {
    headers: { "Content-Type": "video/mp4" }
  });
}
