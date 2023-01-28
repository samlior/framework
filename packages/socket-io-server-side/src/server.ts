import { Server } from "socket.io";
import {
  Scheduler,
  ReturnTypeIs,
  JSONRPC,
  JSONRPCErrorCode,
  debug,
  warn,
  error,
  JSONRPCRequest,
  JSONRPCNotify,
} from "@samlior/utils";

export class ServerSideHandlerResponse {
  notify?: {
    method: string;
    params?: any;
  };
  response?: any;

  constructor(
    notify?: {
      method: string;
      params?: any;
    },
    response?: any
  ) {
    if (
      (notify === undefined && response === undefined) ||
      (notify !== undefined && response !== undefined)
    ) {
      throw new Error("invalid response");
    }
    this.notify = notify;
    this.response = response;
  }
}

export type ServerSideHandleFunc1 = (params: any) => ReturnTypeIs<any>;
export type ServerSideHandleFunc2 = (
  from: string,
  params: any
) => ReturnTypeIs<any>;
export type ServerSideHandleFunc =
  | ServerSideHandleFunc1
  | ServerSideHandleFunc2;

export interface IServerSideHandler {
  parent?: Scheduler;
  handle: ServerSideHandleFunc;
}

export type SeverSideHandler = IServerSideHandler | ServerSideHandleFunc;

function isServerSideHandleFunc1(
  handle: ServerSideHandleFunc
): handle is ServerSideHandleFunc1 {
  return handle.length === 1;
}

export interface SocketIOServerSideOptions {
  // 服务器名字
  name: string;
  // SocketIO 服务器实例
  server: Server;
  // 父级调度器
  parent?: Scheduler;
}

export class SocketIOServerSide {
  readonly scheduler: Scheduler;
  readonly name: string;
  readonly server: Server;
  readonly handlers = new Map<string, SeverSideHandler>();
  readonly jsonrpc = new JSONRPC();

  constructor({ name, server, parent }: SocketIOServerSideOptions) {
    if (name === "all") {
      throw new Error("invalid server name");
    }
    this.name = name;
    this.server = server;
    this.scheduler = new Scheduler(parent);
  }

  /**
   * 处理消息
   * @param from - 消息来源
   * @param to - 消息接受者
   * @param data - 消息内容
   */
  private handle = (from: string, to: string, data: any) => {
    if (to !== "all" && to !== this.name) {
      // ignore message
      return;
    }

    // 1. 解析内容, 如果是返回结果的话, 交给 jsonrpc 处理
    let requestOrNotify: JSONRPCRequest | JSONRPCNotify;
    try {
      const [_type, _result] = JSONRPC.parse(data);
      if (_type === "response") {
        if (!this.jsonrpc.response(_result)) {
          debug("SocketIOServerSide::handle", "invalid response, ignore");
        }
        return;
      }
      requestOrNotify = _result;
    } catch (err) {
      debug("SocketIOServerSide::handle", "invalid request:", err);
      this._message(from, JSONRPC.formatJSONRPCError(err));
      return;
    }

    // 2. 获取对应的 handler
    const { id, method, params } = requestOrNotify;
    const handler = this.handlers.get(method);
    if (handler === undefined) {
      debug("SocketIOServerSide::handle", "method not found:", method);
      id !== undefined &&
        this._message(
          from,
          JSONRPC.formatJSONRPCError(JSONRPCErrorCode.NotFound, id)
        );
      return;
    }
    let scheduler: Scheduler;
    let handle: ServerSideHandleFunc;
    if (typeof handler === "function") {
      scheduler = new Scheduler(this.scheduler);
      handle = handler;
    } else {
      scheduler = new Scheduler(handler.parent ?? this.scheduler);
      handle = handler.handle.bind(handler);
    }

    // 3. 开始调度
    scheduler
      .exec(
        isServerSideHandleFunc1(handle) ? handle(params) : handle(from, params)
      )
      .then((response) => {
        if (response instanceof ServerSideHandlerResponse) {
          const { notify: _notify, response: _response } = response;
          if (_notify) {
            this._message(
              from,
              JSONRPC.formatJSONRPCNotify(_notify.method, _notify.params)
            );
            return;
          } else {
            response = _response;
          }
        }
        if (response !== undefined) {
          if (id === undefined) {
            // 这是一个通知, 无法返回
            warn("SocketIOServerSide::handle", "cannot response a notify");
          } else {
            this._message(from, JSONRPC.formatJSONRPCResult(id, response));
          }
        }
      })
      .catch((err) => {
        error("SocketIOServerSide::handle", "catch error:", err);
        id !== undefined &&
          this._message(from, JSONRPC.formatJSONRPCError(err, id));
      })
      .finally(() => {
        scheduler.destroy();
      });
  };

  /**
   * 发送消息(底层方法)
   * @param to - 消息接受者
   * @param data - 消息内容
   */
  _message(to: string, data: any) {
    this.server.serverSideEmit("message", this.name, to, data);
  }

  /**
   * 广播(底层方法)
   * @param data - 消息内容
   */
  _broadcast(data: any) {
    this.server.serverSideEmit("message", this.name, "all", data);
  }

  /**
   * 发出请求
   * @param to - 消息接受者
   * @param method - 方法名称
   * @param params - 参数
   * @returns 返回结果
   */
  request(to: string, method: string, params?: any) {
    const { request, getResult } = this.jsonrpc.request(method, params);
    this._message(to, request);
    return getResult;
  }

  /**
   * 发送通知
   * @param to - 消息接受者
   * @param method - 方法名称
   * @param params - 参数
   */
  notify(to: string, method: string, params?: any) {
    this._message(to, JSONRPC.formatJSONRPCNotify(method, params));
  }

  /**
   * 广播
   * @param method - 方法名称
   * @param params 参数
   */
  broadcast(method: string, params?: any) {
    this._broadcast(JSONRPC.formatJSONRPCNotify(method, params));
  }

  /**
   * 开始
   */
  start() {
    this.server.on("message", this.handle);
  }

  /**
   * 停止
   */
  stop() {
    this.server.off("message", this.handle);
  }

  /**
   * 中断
   * @param reason - 理由
   */
  abort(reason: any) {
    this.scheduler.abort(reason);
    this.jsonrpc.abort(reason);
  }

  /**
   * 恢复
   */
  resume() {
    this.scheduler.resume();
  }

  /**
   * 等待直到所有调用完成
   */
  wait() {
    return Promise.all([this.jsonrpc.wait(), this.scheduler.wait()]);
  }

  /**
   * 注册 handler
   * @param method - 方法名
   * @param handler - 处理器
   */
  register(method: string, handler: IServerSideHandler) {
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
