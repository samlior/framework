import { ReturnTypeIs } from "@samlior/utils";
import { IHTTPHanlder, startup, shutdown } from "../src";

class EchoHandler implements IHTTPHanlder {
  async *handle(params: any): ReturnTypeIs<string> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return params;
  }
}

async function main() {
  const { server, terminator } = await startup(
    { maxTokens: 10, maxQueued: 2 },
    "/namespace",
    54321
  );
  server.register("echo", new EchoHandler());
  server.start();
  console.log("http echo server startup");
  let exiting = false;
  process.on("SIGINT", () => {
    if (!exiting) {
      console.log("exiting...");
      exiting = true;
      shutdown(server, terminator)
        .then(() => process.exit(0))
        .catch((err) => {
          console.log("exiting, catch error:", err);
          process.exit(1);
        });
    }
  });
}

main().catch((err) => console.log("main, catch error:", err));
