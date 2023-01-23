# `@samlior/socket-io-client`

`@samlior/socket-io-client` is a socketIO client based on JSONRPC.

## Install

```sh
npm install @samlior/socket-io-client
```

## Usage

```ts
import {
  SocketIOClientManager,
  ISocketIOHandler,
} from "@samlior/socket-io-client";
import { ReturnTypeIs } from "@samlior/utils";

class MockClientEchoHandler implements ISocketIOHandler {
  async *handle(params: any): ReturnTypeIs<string> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return "from client " + params;
  }
}

async function main() {
  const manager = new SocketIOClientManager();
  const client = await manager.connect("wss://aaa.bbb.ccc/namespace");
  console.log("response:", await client.request("method", "params"));
  client.close();
}

main().catch((err) => console.log("main, catch error:", err));
```
