import { en, type CopyKey } from './en';

type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | ParamNames<Rest>
  : never;

export type ParamsOf<K extends CopyKey> = {
  readonly [P in ParamNames<(typeof en)[K]>]: string | number;
};

type ParamArgs<K extends CopyKey> = [ParamNames<(typeof en)[K]>] extends [never]
  ? [params?: undefined]
  : [params: ParamsOf<K>];

/** Look up a catalog string and fill its `{name}` placeholders. A missing param is a compile error. */
export function t<K extends CopyKey>(key: K, ...args: ParamArgs<K>): string {
  const template: string = en[key];
  const params: Readonly<Record<string, string | number>> = args[0] ?? {};
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
