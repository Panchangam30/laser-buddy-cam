import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DocsPage } from "./docs/DocsPage";
import { ThumbPage } from "./three/ThumbPage";
import { RemotePage } from "./remote/RemotePage";
import { AimPage } from "./remote/AimPage";

const path = window.location.pathname;
const page = path.startsWith("/docs") ? <DocsPage />
  : path.startsWith("/thumb") ? <ThumbPage />
  : path.startsWith("/remote/aim") ? <AimPage />
  : path.startsWith("/remote") ? <RemotePage />
  : <App />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
