import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Claude Code White",
    short_name: "Claude Code White",
    description: "本机 Claude Code CLI 桌面工作台（多会话并行、双主题、零上传）",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF7F5",
    theme_color: "#D97757",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
