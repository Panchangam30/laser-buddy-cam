import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DocsPage } from "./docs/DocsPage";
import { ThumbPage } from "./three/ThumbPage";
import { RemotePage } from "./remote/RemotePage";
import { AimPage } from "./remote/AimPage";
import { HubPage } from "./hub/HubPage";

import { PreferencesProvider } from "./lib/preferences";
import { Settings } from "./components/Settings";
import "./theme.css";

const path = window.location.pathname;
const page = path.startsWith("/docs") ? <DocsPage />
  : path.startsWith("/hub") ? <HubPage />
  : path.startsWith("/thumb") ? <ThumbPage />
  : path.startsWith("/remote/aim") ? <AimPage />
  : path.startsWith("/remote") ? <RemotePage />
  : <App />;

// The thumbnail route is captured to PNG by scripts/thumbs.mjs; a settings
// button there ends up in every part image.
const settings = path.startsWith("/thumb") ? null : <Settings />;

createRoot(document.getElementById("root")!).render(<StrictMode><PreferencesProvider>{page}{settings}</PreferencesProvider></StrictMode>);
