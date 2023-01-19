import LinkedList, { Node } from "yallist";
import { Counter } from "./counter";

// Token 的状态
export enum TokenStatus {
  // 空闲中, Token 在队列中没有被使用
  Idle,
  // 工作中, Token 从队列中拿出, 并且正在使用
  Working,
  // 停止, Token 从队列中拿出, 但没有被使用
  Stopped,
}

// 一个 Token 代表一个并发
export class Token {
  readonly limited: Limited;

  // 当前状态, 不建议外部修改
  status: TokenStatus = TokenStatus.Idle;

  constructor(limited: Limited) {
    this.limited = limited;
  }

  /**
   * 执行异步任务
   * @param promise - 承诺
   * @returns 结果
   */
  async invoke<T>(promise: Promise<T>): Promise<T> {
    if (this.status !== TokenStatus.Stopped) {
      throw new Error("invalid token status");
    }

    try {
      this.status = TokenStatus.Working;
      return await promise;
    } finally {
      this.status = TokenStatus.Stopped;
    }
  }

  /**
   * 执行异步任务
   * @param generator - 生成器
   * @returns 结果
   */
  async *invoke2<T = unknown, TReturn = any, TNext = unknown>(
    generator: AsyncGenerator<T, TReturn, TNext>
  ): AsyncGenerator<T, TReturn, TNext> {
    if (this.status !== TokenStatus.Stopped) {
      throw new Error("invalid token status");
    }

    try {
      this.status = TokenStatus.Working;
      return yield* generator;
    } finally {
      this.status = TokenStatus.Stopped;
    }
  }
}

// 获取 Token 请求的状态
export enum RequestStatus {
  // 在队列中
  Queued,
  // 已完成
  Finished,
  // 已取消
  Canceled,
}

export type RequestValue = {
  status: RequestStatus;
  resolve: (token: Token) => void;
  reject: (reason?: any) => void;
};

export type Request = Node<RequestValue>;

function toNode<T>(value: T) {
  return {
    prev: null,
    next: null,
    value,
  };
}

// 并发控制器
export class Limited {
  private readonly idle = LinkedList.create<Token>();
  private readonly queue = LinkedList.create<RequestValue>();
  private readonly maxTokens: number;
  private readonly maxQueued: number;
  private readonly counter = new Counter();

  /**
   * @param maxTokens - 最大并发数量
   * @param maxQueued - 最大请求队列数量
   */
  constructor(maxTokens: number, maxQueued: number) {
    for (let i = 0; i < maxTokens; i++) {
      this.idle.push(new Token(this));
    }
    this.maxTokens = maxTokens;
    this.maxQueued = maxQueued;
  }

  /**
   * 获取当前并发数量
   */
  get parallels() {
    return this.counter.count;
  }

  /**
   * 获取当前可用的并发数量
   */
  get tokens() {
    return this.maxTokens - this.parallels;
  }

  /**
   * 获取当前队列中的请求数量
   */
  get queued() {
    return this.queue.length;
  }

  /**
   * 获取当前可用的队列数量
   */
  get available() {
    return this.maxQueued - this.queued;
  }

  /**
   * 获取一个 Token
   * 如果请求队列达到上限则会抛出异常
   * @returns 获取 Token 的承诺和请求对象
   *          如果请求对象不存在则代表立即获取了 Token
   */
  get(): { getToken: Promise<Token>; request?: Request } {
    if (this.idle.length > 0) {
      const token = this.idle.shift()!;
      token.status = TokenStatus.Stopped;
      this.counter.increase();
      return { getToken: Promise.resolve(token) };
    } else if (this.queue.length + 1 <= this.maxQueued) {
      let resolve!: (token: Token) => void;
      let reject!: (reason?: any) => void;
      const getToken = new Promise<Token>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
      });
      const requestValue: RequestValue = {
        status: RequestStatus.Queued,
        resolve,
        reject,
      };
      const request = toNode(requestValue);
      this.queue.pushNode(request);
      return { getToken, request };
    } else {
      throw new Error("too many queued");
    }
  }

  /**
   * 放回使用完毕的 Token
   * @param token - Token 对象
   */
  put(token: Token) {
    if (token.limited !== this || token.status !== TokenStatus.Stopped) {
      throw new Error("invalid token");
    }
    if (this.queue.length > 0) {
      const request = this.queue.shift()!;
      request.status = RequestStatus.Finished;
      request.resolve(token);
    } else {
      token.status = TokenStatus.Idle;
      this.idle.push(token);
      this.counter.decrease();
    }
  }

  /**
   * 取消获取 Token 的请求
   * @param request - 请求对象
   * @param reason - 取消原因(会作为异常抛出)
   */
  cancel(request: Request, reason?: any) {
    if (request.list !== this.queue) {
      throw new Error("invalid request");
    }
    if (request.value.status !== RequestStatus.Queued) {
      return;
    }
    this.queue.removeNode(request);
    request.value.status = RequestStatus.Canceled;
    request.value.reject(reason);
  }

  /**
   * 等到所有 Token 都被放回队列
   */
  wait() {
    return this.counter.wait();
  }
}
