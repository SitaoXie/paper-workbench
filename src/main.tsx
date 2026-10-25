import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LocaleProvider } from "./i18n";
import "./styles.css";
import "./assistant-dock.css";
import "./reading-workspace.css";
import "./workspace-polish.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </React.StrictMode>,
);
