# `@samlior/socket-io-server-side`

`@samlior/socket-io-server-side` is a server backend based on JSONRPC and Redis.

## Install

```sh
npm install @samlior/socket-io-server-side
```

## Usage

```ts
import { Server } from "socket.io";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import {
  SocketIOServerSide,
  IServerSideHandler,
} from "@samlior/socket-io-server-side";
import { ReturnTypeIs } from "@samlior/utils";

const redisURL = "redis://default:redispw@localhost:49153";

class MockEchoHandler implements IServerSideHandler {
  async *handle(params: any): ReturnTypeIs<string> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return params;
  }
}

const pub = createClient({ url: redisURL });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);
const server = new Server();
server.adapter(createAdapter(pub, sub));
server.listen(8080);
const serverSide = new SocketIOServerSide({ name: "name", server });

// register
serverSide.register("echo", new MockEchoHandler());

// start
serverSide.start();

process.on("SIGINT", async () => {
  serverSide.stop();
  await serverSide.wait();
  process.exit(0);
});
```
