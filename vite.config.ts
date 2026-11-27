import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tailwindcss(), {
    name: "docrunnel-license-notices",
    generateBundle() {
      for (const [fileName, source] of [
        ["licenses/inter.txt", "./node_modules/@fontsource-variable/inter/LICENSE"],
        ["licenses/shadcn.md", "./src/components/ui/LICENSE.shadcn.md"],
      ]) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(new URL(source, import.meta.url)) });
      }
    },
  }],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
});
