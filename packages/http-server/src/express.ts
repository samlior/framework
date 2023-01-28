import http from "http";
import express from "express";
import compression from "compression";
import { createHttpTerminator, HttpTerminator } from "http-terminator";
import { warn, debug, timeout } from "@samlior/utils";
import { HTTPServer, HTTPServerOptions } from "./server";

/**
 * 构建并快速开启 HTTP 服务器
 * @param options - HTTPServer 参数
 * @param namespace - 命名空间
 * @param port - 端口
 * @param hostname - 绑定的 ip
 * @returns http.Server 实例, HTTPServer 实例以及中断器
 */
export async function startup(
  options: HTTPServerOptions,
  namespace: string = "/",
  port: number = 3000,
  hostname: string = "localhost"
) {
  const server = new HTTPServer(options);
  const app = express();
  app
    .post(namespace)
    .use(compression())
    .use(server.checkIfStopped())
    // TODO: 不受并发限制的请求在这里也会受到限制
    //       不过也许可以忽略?
    .use(server.checkIfAvailable())
    .use(express.json())
    .use(server.handle())
    .use((err, req, res, next) => {
      // ignore errors
      debug("startup", "catch error:", err);
      next();
    });
  const httpServer = await new Promise<http.Server>((resolve) => {
    const httpServer = app.listen(port, hostname, () => {
      resolve(httpServer);
    });
  });
  return {
    server,
    httpServer,
    terminator: createHttpTerminator({ server: httpServer }),
  };
}

/**
 * 关闭服务器
 * @param server - HTTPServer 实例
 * @param terminator - 中断器
 * @param duration - 超时时间
 */
export async function shutdown(
  server: HTTPServer,
  terminator: HttpTerminator,
  duration: number = 5000
) {
  // 停止接受新请求
  server.stop();
  // 等待所有请求处理完毕
  await timeout(server.wait(), duration).catch(() =>
    warn("shutdown", "wait timeout")
  );
  // 中断所有链接
  await terminator
    .terminate()
    .catch((err) => warn("shutdown", "terminate catch error:", err));
}
