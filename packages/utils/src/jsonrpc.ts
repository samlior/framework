import { Counter } from "./counter";

type ReqDetail = {
  resolve: (params?: any) => void;
  reject: (reason?: any) => void;
  timeout?: NodeJS.Timeout;
};

export enum JSONRPCErrorCode {
  Parse = -32700,
  InvalidRequest = -32600,
  NotFound = -32601,
  Internal = -32603,
  Sever = -32000,
}

export class JSONRPCError extends Error {
  readonly code: number;

  constructor(code: number, message?: string) {
    super(message);
    this.code = code;
  }
}

export type JSONRPCRequest = { id: any; method: string; params: any };

export type JSONRPCNotify = { id: undefined; method: string; params: any };

export type JSONRPCResponse = { id: any; result?: any; error?: any };

export class JSONRPC {
  private autoId: number = Number.MIN_SAFE_INTEGER;
  private readonly reqs = new Map<string, ReqDetail>();
  private readonly counter = new Counter();

  /**
   * 生成 jsonrpc 请求内容
   * @param id - jsonrpc id
   * @param method - 方法名
   * @param params - 参数
   * @returns 格式化好的请求内容
   */
  static formatJSONRPCRequest(id: string, method?: string, params?: any) {
    const req = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return req;
  }

  /**
   * 生成 jsonrpc 通知内容
   * @param method - 方法名
   * @param params - 参数
   * @returns 格式化好的通知内容
   */
  static formatJSONRPCNotify(method: string, params?: any) {
    const req = {
      jsonrpc: "2.0",
      method,
      params,
    };
    return req;
  }

  /**
   * 生成 jsonrpc 错误内容
   * @param codeOrError - 错误码或异常
   * @param id - jsonrpc id
   * @param message - 错误消息
   * @returns 格式化好的错误内容
   */
  static formatJSONRPCError(codeOrError: any, id?: string, message?: string) {
    let req: any;
    if (typeof codeOrError === "number") {
      req = {
        jsonrpc: "2.0",
        id,
        error: {
          code: codeOrError,
          message,
        },
      };
    } else if (typeof codeOrError === "string") {
      req = {
        jsonrpc: "2.0",
        id,
        error: {
          code: JSONRPCErrorCode.Internal,
          message: codeOrError,
        },
      };
    } else if (codeOrError instanceof JSONRPCError) {
      req = {
        jsonrpc: "2.0",
        id,
        error: {
          code: codeOrError.code,
          message: codeOrError.message,
        },
      };
    } else if (codeOrError instanceof Error) {
      req = {
        jsonrpc: "2.0",
        id,
        error: {
          code: JSONRPCErrorCode.Internal,
          message: codeOrError.message,
        },
      };
    } else {
      req = {
        jsonrpc: "2.0",
        id,
        error: {
          code: JSONRPCErrorCode.Internal,
          message: "internal unknown error",
        },
      };
    }
    return req;
  }

  /**
   * 生成 jsonrpc 返回内容
   * @param id - jsonrpc id
   * @param result - 返回结果
   * @returns 格式化好的返回内容
   */
  static formatJSONRPCResult(id: string, result?: any) {
    const req = {
      jsonrpc: "2.0",
      id,
      result,
    };
    return req;
  }

  /**
   * 解析接收到的消息
   * @param data - 消息
   * @returns 可能请求, 通知或返回
   */
  static parse(
    data: any
  ):
    | ["request", JSONRPCRequest]
    | ["response", JSONRPCResponse]
    | ["notify", JSONRPCNotify] {
    let json: any;
    try {
      // 解析 json
      json = typeof data === "string" ? JSON.parse(data) : data;
    } catch (err) {
      throw new JSONRPCError(JSONRPCErrorCode.Parse, "invalid json format");
    }

    // 检查格式是否合法
    if (json.jsonrpc !== "2.0") {
      throw new JSONRPCError(
        JSONRPCErrorCode.InvalidRequest,
        "invalid version"
      );
    }

    // 解析是请求还是返回
    if (json.method) {
      if (typeof json.method !== "string") {
        throw new JSONRPCError(
          JSONRPCErrorCode.InvalidRequest,
          "invalid method"
        );
      }
      if (json.id) {
        return [
          "request",
          { id: json.id, method: json.method, params: json.params },
        ];
      } else {
        return [
          "notify",
          { id: undefined, method: json.method, params: json.params },
        ];
      }
    } else {
      if (!json.result && !json.error) {
        throw new JSONRPCError(
          JSONRPCErrorCode.InvalidRequest,
          "invalid result or error"
        );
      }
      return [
        "response",
        { id: json.id, result: json.result, error: json.error },
      ];
    }
  }

  /**
   * 获取当前等待中的请求数量
   */
  get requests() {
    return this.counter.count;
  }

  // 生成 jsonrpc id
  private genId() {
    const id = this.autoId++;
    if (id === Number.MAX_SAFE_INTEGER) {
      this.autoId = Number.MIN_SAFE_INTEGER;
    }
    return id.toString();
  }

  /**
   * 中断
   * @param reason - 错误信息
   */
  abort(reason?: any) {
    for (const [, { reject, timeout }] of this.reqs) {
      this.counter.decrease();
      timeout && clearTimeout(timeout);
      reject(reason);
    }
    this.reqs.clear();
  }

  /**
   * 发出请求
   * @param method - 方法
   * @param params - 参数
   * @param timeout - 超时时间, -1 代表永不超时
   * @returns 需要被发送到远程的内容和请求结果
   */
  request(method: string, params?: any, timeout = 5000) {
    const id = this.genId();
    this.counter.increase();
    return {
      request: JSONRPC.formatJSONRPCRequest(id, method, params),
      getResult: new Promise<any>((resolve, reject) => {
        this.reqs.set(id, {
          resolve,
          reject,
          timeout:
            timeout === -1
              ? undefined
              : setTimeout(() => {
                  if (this.reqs.delete(id)) {
                    this.counter.decrease();
                    reject(new Error("jsonrpc timeout"));
                  }
                }, timeout),
        });
      }),
    };
  }

  /**
   * 处理接收到的消息,
   * 如果处理成功则返回 true
   * @param param0 - 请求内容
   * @returns 是否处理成功
   */
  response({ id, result, error }: JSONRPCResponse): boolean {
    const detail = this.reqs.get(id);
    if (!detail) {
      return false;
    }
    this.counter.decrease();
    this.reqs.delete(id);
    const { resolve, reject, timeout } = detail;
    timeout && clearTimeout(timeout);
    error ? reject(error) : resolve(result);
    return true;
  }

  /**
   * 等待直到所有请求完成
   */
  wait() {
    return this.counter.wait();
  }
}
