/** Vite-style raw imports: the file's contents as a string (see tsup.config.ts). */
declare module "*?raw" {
   const contents: string;
   export default contents;
}
