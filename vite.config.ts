import { defineConfig } from "vite";

// Deployed as a GitHub Pages project site: https://<owner>.github.io/aogr/
export default defineConfig({
  base: "/aogr/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
