import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FraudCell · Risk Command",
    short_name: "FraudCell",
    description: "Gerçek zamanlı yapay zekâ destekli dolandırıcılık operasyon platformu",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7fafc",
    theme_color: "#034ea2",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
