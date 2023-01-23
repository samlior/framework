# `@samlior/http-client`

`@samlior/http-client` is an interruptible HTTP client based on JSONRPC.

## Install

```sh
npm install @samlior/http-client
```

## Usage

```ts
import { HTTPClient } from "@samlior/http-client";

const client = new HTTPClient("https://aaa.bbb.ccc");

const { abort, getResult } = client.request("method", "params");

getResult
  .then((response) => console.log("response:", response))
  .catch((err) => console.log("error:", err));

process.on("SIGINT", () => {
  abort(new Error("SIGINT"));
  // OR
  // client.abort(new Error("SIGINT"));

  // do something...

  process.exit(0);
});
```
