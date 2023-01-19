import { HTTPClient } from "../src";

async function main() {
  const client = new HTTPClient("http://127.0.0.1:54321/namespace");
  let i = 0;
  while (true) {
    const { getResult } = client.request("echo", `wuhu${i++}`);
    console.log("result:", await getResult.catch((err) => `wuhu${i} failed`));
    await new Promise<void>((r) => setTimeout(r, 1000));
  }
}

main().catch((err) => console.log("main, catch error:", err));
