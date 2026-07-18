// Build-time constant injected by tsup define and Vite. Truthy in dev/test; statically false
// in production so the minifier eliminates every if (__DEV__) branch.
declare const __DEV__: boolean;
