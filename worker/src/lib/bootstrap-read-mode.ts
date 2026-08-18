export async function readSelectedBootstrap<TLegacy, TUnified>(
  unifiedEnabled: boolean,
  readers: {
    legacy: () => Promise<TLegacy>;
    unified: () => Promise<TUnified>;
  },
): Promise<
  | { mode: "legacy"; value: TLegacy }
  | { mode: "unified"; value: TUnified }
> {
  if (unifiedEnabled) {
    return { mode: "unified", value: await readers.unified() };
  }
  return { mode: "legacy", value: await readers.legacy() };
}
