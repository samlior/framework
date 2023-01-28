# `@samlior/socket-io-server`

`@samlior/socket-io-server` is a socketIO server based on JSONRPC.

## Install

```sh
npm install @samlior/socket-io-server
```

## Usage

```ts
import { startup } from "@samlior/socket-io-server";
import { ISocketIOHandler } from "@samlior/socket-io-client";
import { ReturnTypeIs } from "@samlior/utils";

class MockEchoHandler implements ISocketIOHandler {
  async *handle(params: any): ReturnTypeIs<string> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return params;
  }
}

const { server, httpServer, terminator } = await startup(
  { maxTokens: 10, maxQueued: 2 },
  8080
);

// register handler
server.register("echo", new MockEchoHandler());

// start
server.start();

process.on("SIGINT", () => {
  // this function will ensure that all executing requests are completed
  // and safely close all client connections
  shutdown(server, terminator);

  // do something...

  process.exit(0);
});
```
