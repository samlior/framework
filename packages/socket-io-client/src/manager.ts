import { io, ManagerOptions, SocketOptions } from "socket.io-client";
import { SocketIOHandler } from "./types";
import { SocketIOClient, SocketIOClientOptions } from "./client";

export class SocketIOClientManager<T = any> {
  readonly handlers: Map<string, SocketIOHandler<T>>;

  constructor(handlers?: Map<string, SocketIOHandler<T>>) {
    this.handlers = handlers ?? new Map<string, SocketIOHandler<T>>();
  }

  /**
   * 链接服务器
   * @param url - 服务器地址
   * @param options - 构造参数和 socket 参数
   * @returns 客户端实例
   */
  async connect(
    url: string,
    options?: Omit<SocketIOClientOptions<T>, "socket"> &
      Partial<ManagerOptions & SocketOptions>
  ) {
    const socket = io(url, {
      transports: options?.transports ?? ["websocket"],
      ...options,
    });
    return new SocketIOClient<T>({
      socket,
      handlers: this.handlers,
      ...options,
    });
  }

  /**
   * 注册 handler
   * @param method - 方法名
   * @param handler - 处理器
   */
  register(method: string, handler: SocketIOHandler<T>) {
    this.handlers.set(method, handler);
  }

  /**
   * 注销 handler
   * @param method - 方法名
   * @returns 是否注销成功
   */
  unregister(method: string) {
    return this.handlers.delete(method);
  }
}
