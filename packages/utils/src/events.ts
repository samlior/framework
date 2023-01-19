export type Listener = (...args: any[]) => void;

export class Events {
  private readonly listeners = new Map<string, Listener[]>();

  /**
   * 注册监听者
   * @param event - 事件名称
   * @param listener - 监听者
   */
  on(event: string, listener: Listener): this {
    let list = this.listeners.get(event);
    if (!list) {
      this.listeners.set(event, (list = []));
    }
    list.push(listener);
    return this;
  }

  /**
   * 移除监听者
   * @param event - 事件名称
   * @param listener - 监听者
   */
  off(event: string, listener: Listener): this {
    const list = this.listeners.get(event);
    if (list) {
      const index = list.indexOf(listener);
      if (index !== -1) {
        list.splice(index, 1);
        if (list.length === 0) {
          this.listeners.delete(event);
        }
      }
    }
    return this;
  }

  /**
   * 发出事件
   * @param event - 事件名称
   * @param args - 参数
   */
  emit(event: string, ...args: any[]): this {
    const list = this.listeners.get(event);
    if (list) {
      list.forEach((listener) => listener(...args));
    }
    return this;
  }
}
