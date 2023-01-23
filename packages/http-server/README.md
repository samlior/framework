# `@samlior/http-server`

`@samlior/http-server` is an interruptible HTTP server based on JSONRPC.

## Install

```sh
npm install @samlior/http-server
```

## Usage

```ts
import { startup, shutdown, IHTTPHanlder } from "@samlior/http-server";
import { ReturnTypeIs } from "@samlior/utils";

class MockEchoHandler implements IHTTPHanlder {
  async *handle(params: any): ReturnTypeIs<string> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return params;
  }
}

const { server, httpServer, terminator } = await startup(
  {
    maxTokens: 10,
    maxQueued: 2,
  },
  "/",
  8080
);

// register handler
server.register("echo", new MockEchoHandler());

process.on("SIGINT", () => {
  // this function will ensure that all executing requests are completed
  // and safely close all client connections
  shutdown(server, terminator);

  // do something...

  process.exit(0);
});
```
