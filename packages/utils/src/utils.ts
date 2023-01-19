/**
 * Generate random integers according to the given range
 * @param min - Minimum limit
 * @param max - Maximum limit
 * @returns The random number
 */
export function getRandomIntInclusive(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  if (max < min) {
    throw new Error(
      "The maximum value should be greater than the minimum value"
    );
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 重试函数
 * @param fn - 回调函数
 * @param times - 重试次数
 * @param sleep - 每次失败后休息的时间
 * @returns 回调函数的结果
 */
export async function retry<T>(
  fn: () => Promise<T>,
  times: number = 3,
  sleep: number = 50
): Promise<T> {
  let i = 0;
  let err: any;
  while (i++ < times) {
    try {
      return await fn();
    } catch (err) {
      if (i === times - 1) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, sleep));
    }
  }
  throw err;
}

/**
 * 超时函数, 如果超时会抛出异常
 * @param promise - 需要等待的承诺
 * @param duration - 超时时长
 * @returns 承诺的返回值
 */
export async function timeout<T>(promise: Promise<T>, duration: number = 1000) {
  let timeout: NodeJS.Timeout | undefined = undefined;
  let resolve: (() => void) | undefined = undefined;
  return (await Promise.race([
    new Promise<void>((_resolve, _reject) => {
      resolve = _resolve;
      timeout = setTimeout(() => {
        resolve = undefined;
        timeout = undefined;
        _reject(new Error("timeout"));
      }, duration);
    }),
    promise,
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (resolve) {
      resolve();
      resolve = undefined;
    }
  })) as Promise<T>;
}
