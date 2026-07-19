const SMARTQ_CONTEXT = Symbol("smartq-context");

export function provideSmartQ(context) {
  Vue.provide(SMARTQ_CONTEXT, context);
}

export function useSmartQ() {
  const context = Vue.inject(SMARTQ_CONTEXT);
  if (!context) throw new Error("SmartQ context is not available");
  return context;
}
