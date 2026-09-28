import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DocsPage } from "./docs/DocsPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{window.location.pathname.startsWith("/docs") ? <DocsPage /> : <App />}</StrictMode>
);
