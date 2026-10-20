// Existing provider fixtures supply their operating transports explicitly.
// Adapt those same spies to the injectable runtime without replacing any rule.
export function runtimeFixture(modules) {
  const auth = Object.entries(modules).find(([key]) => /(?:^|\/)AuthContext$/.test(key))?.[1];
  const runtime = Object.assign({ isTest: false, path: path => path }, ...Object.values(modules).filter(value => value && typeof value === 'object'));
  return { useWorkspaceRuntime: () => runtime, useRuntimeAuth: auth?.useAuth || (() => ({})) };
}

export const diagnosticGlobals = { recordDiagnostic() {}, diagnosticScopeRef: { current: null },
  sttDiagnostics: { record() {}, sink: () => () => {}, flush: async () => {}, export: async () => ({ events: [] }) } };
