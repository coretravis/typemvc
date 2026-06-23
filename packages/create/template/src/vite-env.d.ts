/// <reference types="vite/client" />

// Teaches TypeScript that importing a .tmvc file yields a view render function.
declare module '*.tmvc' {
  import type { TmvcViewFunction } from '@typemvc/core';
  const template: TmvcViewFunction;
  export default template;
}
