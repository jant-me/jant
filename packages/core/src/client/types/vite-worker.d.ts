/**
 * Vite's `?worker&inline` import: the worker script bundled into the importing
 * chunk and started from a `blob:` URL. Declared here rather than by pulling
 * in all of `vite/client`, which also types `import.meta.env` and every asset
 * suffix — none of which the client uses.
 */
declare module "*?worker&inline" {
  const workerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default workerConstructor;
}
