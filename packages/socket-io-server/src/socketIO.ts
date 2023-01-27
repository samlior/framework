import http from "http";
import { Server } from "socket.io";
import { createHttpTerminator, HttpTerminator } from "http-terminator";
import { error, timeout, warn } from "@samlior/utils";
import { SocketIOServer, SocketIOServerOptions } from "./server";

/**
 * 快速构建并开启 SocketIO 服务器
 * @param options - 构造参数
 * @param port - 端口
 * @param hostname - 绑定的 ip
 * @returns http.Server 实例, SocketIOServer 实例以及中断器
 */
export async function startup<T = any>(
  options: Omit<SocketIOServerOptions<T>, "server">,
  port: number = 3000,
  hostname: string = "localhost"
) {
  const httpServer = http.createServer();
  const socketIOServer = new Server(httpServer);
  const server = new SocketIOServer<T>({ server: socketIOServer, ...options });
  const terminator = createHttpTerminator({ server: httpServer });
  httpServer.listen(port, hostname);
  await new Promise<void>((resolve, reject) => {
    let onListenning: any;
    let onError: any;
    httpServer.on(
      "listening",
      (onListenning = () => {
        httpServer.off("listening", onListenning);
        httpServer.off("error", onError);
        resolve();
      })
    );
    httpServer.on(
      "error",
      (onError = (err) => {
        httpServer.off("listening", onListenning);
        httpServer.off("error", onError);
        reject(err);
      })
    );
  });
  return { server, httpServer, terminator };
}

/**
 * 关闭 SocketIO 服务器
 * @param server - SocketIOServer 实例
 * @param terminator - 中断器
 * @param duration - 超时时间
 */
export async function shutdown<T = any>(
  server: SocketIOServer<T>,
  terminator: HttpTerminator,
  duration: number = 5000
) {
  // 停止服务器接受新链接
  server.stop();
  // 停止客户端接受新请求
  for (const client of server.clients.values()) {
    client.stop();
  }
  await timeout(server.wait(), duration).catch(() =>
    warn("shutdown, wait timeout")
  );
  // 不要主动关闭客户端
  // 不然 socketIO 会发送关闭命令, 导致客户端不会重连
  // for (const client of server.clients.values()) {
  //   client.close();
  // }
  // 关闭 socketIO
  await new Promise<void>((resolve) => {
    server.server.close((err) => {
      if (err) {
        error("shutdown, catch error:", err);
      }
      resolve();
    });
  });
  await terminator
    .terminate()
    .catch((err) => warn("shutdown, terminate catch error:", err));
}
