import { inject, provide } from "vue";

const SMARTQ_CONTEXT = Symbol("smartq-context");

export function provideSmartQ(context) {
  provide(SMARTQ_CONTEXT, context);
}

export function useSmartQ() {
  const context = inject(SMARTQ_CONTEXT);
  if (!context) throw new Error("SmartQ context is not available");
  return context;
}
