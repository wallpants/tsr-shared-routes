import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { routeFileIgnorePattern } from "tanstack-shared-routes";
import { sharedRoutes } from "tanstack-shared-routes/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    // routeFileIgnorePattern is configured inline below (invisible to the
    // plugin's tsr.config.json probe), so the reminder warning is silenced.
    sharedRoutes({ silenceIgnorePatternWarning: true, gitignore: false }),
    tanstackStart({
      router: { routeFileIgnorePattern },
    }),
    viteReact(),
  ],
});
