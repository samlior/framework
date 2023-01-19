import LinkedList, { Node } from "yallist";
import { Counter } from "./counter";
import { Events } from "./events";

function toNode<T>(value: T): Node<T> {
  return {
    prev: null,
    next: null,
    value,
  };
}

export type Result<T> =
  | {
      ok: false;
      error: any;
      result?: T;
    }
  | {
      ok: true;
      error?: undefined;
      result: T;
    };

type RaceResolved = [any, any];

class RaceRequest<T = any> {
  readonly promise: Promise<T>;

  constructor(promise: Promise<T>) {
    this.promise = promise;
  }
}

function mergeResults<T>(
  ok: boolean,
  error: any,
  result?: Result<T>
): Result<T> {
  if (!ok) {
    if (result && !result.ok) {
      return result;
    } else {
      return { ok, error, result: result?.result };
    }
  } else {
    return result!;
  }
}

/**
 * 封装可能抛出异常的承诺,
 * 使它不会抛出异常, 而是返回错误
 * @param promise - 承诺
 * @returns 结果
 */
export function toNoExcept<T>(promise: Promise<T>): Promise<Result<T>> {
  return promise
    .then((result) => {
      return { ok: true, error: undefined, result };
    })
    .catch((error) => {
      return { ok: false, error };
    });
}

/**
 * 封装返回结果的函数,
 * 使它抛出异常而不是返回
 * @param promise - 承诺
 * @returns 结果
 */
export function fromNoExcept<T>(promise: Promise<Result<T>>): Promise<T> {
  return promise.then(({ ok, error, result }) => {
    if (!ok) {
      throw error;
    }
    return result!;
  });
}

/**
 * 运行不会抛出异常的子任务
 * @param promise - 承诺
 * @returns 结果
 */
export async function* runNoExcept<T>(
  promise: Promise<Result<T>>
): AsyncGenerator<Result<T>, Result<T>, Result<Result<T>>> {
  try {
    const { ok, error, result } = yield await promise;
    return mergeResults(ok, error, result);
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * 运行可能会抛出异常的子任务
 * @param promise - 承诺
 * @returns 结果
 */
export async function* run<T>(
  promise: Promise<T>
): AsyncGenerator<T, T, Result<T>> {
  const { ok, error, result } = yield await promise;
  if (!ok) {
    throw error;
  }
  return result;
}

/**
 * 运行不会抛出异常的子任务
 * 如果中断的话, 不会等待子任务完成
 * @param promise - 承诺
 * @returns 结果
 */
export async function* raceNoExcept<T>(
  promise: Promise<Result<T>>
): AsyncGenerator<RaceRequest<Result<T>>, Result<T>, Result<Result<T>>> {
  const { ok, error, result } = yield new RaceRequest<Result<T>>(promise);
  return mergeResults(ok, error, result);
}

/**
 * 运行可能会抛出异常的子任务
 * 如果中断的话, 不会等待子任务完成
 * @param promise - 承诺
 * @returns 结果
 */
export async function* race<T>(
  promise: Promise<T>
): AsyncGenerator<RaceRequest<T>, T, Result<T>> {
  const { ok, error, result } = yield new RaceRequest<T>(promise);
  if (!ok) {
    throw error;
  }
  return result;
}

/**
 * 检查是否中断,
 * 如果中断的话会返回错误
 * @returns 空
 */
export async function* checkNoExcept(): AsyncGenerator<
  Result<void>,
  Result<any>,
  Result<any>
> {
  return yield { ok: true, result: undefined };
}

/**
 * 检查是否中断,
 * 如果中断的话会抛出异常
 * @returns 空
 */
export async function* check(): AsyncGenerator<void, void, Result<any>> {
  const { ok, error, result } = yield undefined;
  if (!ok) {
    throw error;
  }
  return result;
}

export type ReturnTypeIs<T> = AsyncGenerator<any, T, Result<any>>;

/**
 * 调度器
 * 调度器由多个层级嵌套而成
 * 上级的调度器中断后, 下级调度器也会中断
 */
export class Scheduler extends Events {
  readonly parent?: Scheduler;

  private _reason: any = undefined;
  private _destroyed: boolean = false;
  private readonly counter = new Counter();
  private readonly races = LinkedList.create<(result: RaceResolved) => void>();

  private listener = () => {
    this.abortRaces();
    this.emit("abort");
  };

  /**
   * @param parent - 父级调度器
   */
  constructor(parent?: Scheduler) {
    super();
    this.parent = parent;
    this.parent?.on("abort", this.listener);
  }

  /**
   * 获取当前的并发数量
   */
  get parallels() {
    return this.counter.count;
  }

  /**
   * 获取中断理由
   */
  get reason() {
    return this._reason === undefined ? this.parent?.reason : this._reason;
  }

  /**
   * 检查是否已中断
   */
  get aborted() {
    return this.reason !== undefined;
  }

  /**
   * 检查是否已经销毁
   */
  get destroyed() {
    return this._destroyed;
  }

  // 中断所有的 race 请求
  private abortRaces() {
    for (const resolve of this.races) {
      resolve([undefined, undefined]);
    }
  }

  /**
   * 中断
   * @param _reason - 中断理由, 不能为 undefiend
   */
  abort(_reason: any) {
    if (_reason === undefined) {
      throw new Error("invalid reason");
    }
    this._reason = _reason;
    this.abortRaces();
    this.emit("abort");
  }

  /**
   * 恢复
   */
  resume() {
    this._reason = undefined;
  }

  /**
   * 增加调用计数
   * @param times - 次数
   */
  increase(times: number = 1) {
    this.counter.increase(times);
    this.parent?.increase(times);
  }

  /**
   * 减少调用计数
   * @param times - 次数
   */
  decrease(times: number = 1) {
    this.counter.decrease(times);
    this.parent?.decrease(times);
  }

  /**
   * 等待当前层以及下层的所有的调用完成
   */
  wait() {
    return this.counter.wait();
  }

  /**
   * 修复调度器对象
   */
  recover() {
    if (this._destroyed) {
      this._destroyed = false;
      this.parent?.on("abort", this.listener);
    }
  }

  /**
   * 销毁调度器对象
   */
  destroy() {
    this._destroyed = true;
    this.parent?.off("abort", this.listener);
  }

  /**
   * 执行任务, 不会抛出异常
   * @param generator - 生成器
   * @returns 返回结果
   */
  async execNoExcept<T>(
    generator: ReturnTypeIs<Result<T>>
  ): Promise<Result<T>> {
    try {
      this.increase();
      let error: any = undefined;
      let result: any = undefined;
      while (true) {
        const _ok = !error && !this.aborted;
        const _error = error ?? this.reason;
        const { value, done } = await generator.next({
          ok: _ok,
          error: _error,
          result,
        });
        if (done) {
          return mergeResults(_ok, _error, value);
        }
        if (value instanceof RaceRequest) {
          if (this.aborted) {
            continue;
          }
          let resolve!: (result: RaceResolved) => void;
          const taskFinishedOrAborted = new Promise<RaceResolved>((r) => {
            resolve = r;
          });
          const node = toNode(resolve);
          this.races.pushNode(node);
          value.promise
            .then((result) => {
              resolve([undefined, result]);
            })
            .catch((error) => {
              resolve([error, undefined]);
            });
          [error, result] = await taskFinishedOrAborted;
          this.races.removeNode(node);
        } else {
          [error, result] = [undefined, value];
        }
      }
    } catch (error) {
      return { ok: false, error };
    } finally {
      this.decrease();
    }
  }

  /**
   * 执行任务, 可能会抛出异常
   * @param generator - 生成器
   * @returns 返回结果
   */
  async exec<T>(generator: ReturnTypeIs<T>): Promise<T> {
    try {
      this.increase();
      let error: any = undefined;
      let result: any = undefined;
      while (true) {
        const _ok = !error && !this.aborted;
        const _error = error ?? this.reason;
        const { value, done } = await generator.next({
          ok: _ok,
          error: _error,
          result,
        });
        if (done) {
          return value;
        }
        if (value instanceof RaceRequest) {
          if (this.aborted) {
            continue;
          }
          let resolve!: (result: RaceResolved) => void;
          const taskFinishedOrAborted = new Promise<RaceResolved>((r) => {
            resolve = r;
          });
          const node = toNode(resolve);
          this.races.pushNode(node);
          value.promise
            .then((result) => {
              resolve([undefined, result]);
            })
            .catch((error) => {
              resolve([error, undefined]);
            });
          [error, result] = await taskFinishedOrAborted;
          this.races.removeNode(node);
        } else {
          [error, result] = [undefined, value];
        }
      }
    } finally {
      this.decrease();
    }
  }
}

/**
 * 生成调度器并执行一个任务, 不会抛出异常
 * @param generator - 生成器
 * @param parent - 父级
 * @returns 结果
 */
export function execNoExcept<T>(
  generator: ReturnTypeIs<Result<T>>,
  parent?: Scheduler
) {
  const scheduler = new Scheduler(parent);
  return {
    abort: (reason?: any) => {
      scheduler.abort(reason);
    },
    getResult: scheduler.execNoExcept(generator),
  };
}

/**
 * 生成调度器并执行一个任务, 可能会抛出异常
 * @param generator - 生成器
 * @param parent - 父级
 * @returns 结果
 */
export function exec<T>(generator: ReturnTypeIs<T>, parent?: Scheduler) {
  const scheduler = new Scheduler(parent);
  return {
    abort: (reason?: any) => {
      scheduler.abort(reason);
    },
    getResult: scheduler.exec(generator),
  };
}
