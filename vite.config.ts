import vinext from "vinext";
import { defineConfig } from "vite";
import { bridgePlugin } from "./bridge/vite-plugin.mjs";

export default defineConfig({
  plugins: [
    vinext(),
    bridgePlugin(),
  ],
});
