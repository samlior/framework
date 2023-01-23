import { io, ManagerOptions, SocketOptions } from "socket.io-client";
import { SocketIOHandler, SocketIOHanlders } from "./types";
import { SocketIOClient, SocketIOClientOptions } from "./client";

export abstract class SocketIOClientManager {
  static readonly handlers: SocketIOHanlders = new Map<
    string,
    SocketIOHandler
  >();

  /**
   * 链接服务器
   * @param url - 服务器地址
   * @param options - 构造参数和 socket 参数
   * @returns 客户端实例
   */
  static async connect(
    url: string,
    options?: Omit<SocketIOClientOptions, "socket"> &
      Partial<ManagerOptions & SocketOptions>
  ) {
    const socket = io(url, {
      transports: options?.transports ?? ["websocket"],
      ...options,
    });
    return new SocketIOClient({
      socket,
      handlers: SocketIOClientManager.handlers,
      ...options,
    });
  }

  /**
   * 注册 handler
   * @param method - 方法名
   * @param handler - 处理器
   */
  static register(method: string, handler: SocketIOHandler) {
    SocketIOClientManager.handlers.set(method, handler);
  }

  /**
   * 注销 handler
   * @param method - 方法名
   * @returns 是否注销成功
   */
  static unregister(method: string) {
    return SocketIOClientManager.handlers.delete(method);
  }
}
