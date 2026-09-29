import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DocsPage } from "./docs/DocsPage";
import { ThumbPage } from "./three/ThumbPage";

const path = window.location.pathname;
const page = path.startsWith("/docs") ? <DocsPage />
  : path.startsWith("/thumb") ? <ThumbPage />
  : <App />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
