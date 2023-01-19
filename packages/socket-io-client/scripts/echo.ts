import { SocketIOClient } from "../src";

async function main() {
  const client = await SocketIOClient.connect(
    "ws://127.0.0.1:65432/namespace",
    {
      reconnectionDelay: 100,
      reconnectionDelayMax: 500,
    }
  );
  let i = 0;
  while (true) {
    console.log("result:", await client.request("echo", `wuhu${i++}`, -1));
    await new Promise<void>((r) => setTimeout(r, 1000));
  }
}

main().catch((err) => console.log("main, catch error:", err));
