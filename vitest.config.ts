import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Edge-function modules that are pure TypeScript (no Deno globals) are
    // tested here too; the sync diff in particular is the safety surface of
    // the Dropbox import and must be exhaustively covered.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "supabase/functions/_shared/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
