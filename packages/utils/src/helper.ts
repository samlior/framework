interface Constructor<T = {}> {
  new (...args: any[]): T;
}

/**
 * This function implements multiple inheritance
 * @param mix1 - The first parameter to be inherited
 * @param mix2 - The second  parameter to be inherited
 * @returns The result after multiple inheritance
 */
export function mixin<T1 extends Constructor, T2 extends Constructor>(
  mix1: T1,
  mix2: T2
): new (...args: any[]) => InstanceType<T1> & InstanceType<T2> {
  const mixinProps = (target, source) => {
    Object.getOwnPropertyNames(source).forEach((prop) => {
      if (/^constructor$/.test(prop)) {
        return;
      }
      Object.defineProperty(
        target,
        prop,
        Object.getOwnPropertyDescriptor(source, prop)!
      );
    });
  };

  let ctor;
  if (mix1 && typeof mix1 === "function") {
    ctor = class extends mix1 {
      constructor(...props) {
        super(...props);
      }
    };
    mixinProps(ctor.prototype, mix2.prototype);
  } else {
    ctor = class {};
  }
  return ctor;
}
