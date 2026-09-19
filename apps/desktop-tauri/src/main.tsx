import React from "react";
import ReactDOM from "react-dom/client";
// Latin-only subsets (was: full 400.css with 51 woff/woff2 across all
// scripts). Cuts dist/assets fonts to ~8 files. Add latin-ext/cyrillic back
// only if the product localizes beyond Latin. See CHANGELOG (P5.24).
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter-tight/latin-600.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import App from "./App";
import { installGlobalErrorHandlers } from "./lib/error-report.js";
import "./styles.css";

installGlobalErrorHandlers();

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
