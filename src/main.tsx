import React from "react";
import ReactDOM from "react-dom/client";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import flagFontUrl from "country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import "./App.css";

// Windows has no flag emojis: load a flags-only font (bundled, the CSP forbids CDNs).
polyfillCountryFlagEmojis("Twemoji Country Flags", flagFontUrl);

function render() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <I18nProvider>
          <TooltipProvider delayDuration={300}>
            <App />
            <Toaster position="bottom-right" richColors closeButton />
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}

// Dev only: `?demo` shows sample tunnels for the README screenshots (see src/demo.ts).
if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo")) {
  import("./demo").then((demo) => demo.installDemo()).then(render);
} else {
  render();
}
