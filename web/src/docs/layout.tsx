import type { ReactNode } from "react";
import "./docs.css";

const NAV = [
  { heading: "Getting started", links: [["Introduction", "introduction"], ["Installation", "installation"], ["First circuit", "first-circuit"]] },
  { heading: "Using the app", links: [["Camera and planning", "camera"], ["3D workspace", "workspace"], ["Live board tracking", "tracking"], ["Voice assistant", "voice"], ["Laser pointer", "laser"]] },
  { heading: "Reference", links: [["Configuration", "configuration"], ["How it works", "architecture"], ["Troubleshooting", "troubleshooting"], ["Safety and limits", "limits"], ["Privacy", "privacy"], ["Terms", "terms"]] },
] as const;

export function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs-site">
      <header className="docs-topbar">
        <a className="docs-brand" href="/"><strong>Laser Buddy</strong><em>Docs</em></a>
        <nav aria-label="Documentation utilities">
          <a href="/">Open workbench</a>
          <a href="https://github.com/Panchangam30/laser-buddy-cam" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>
      <aside className="docs-sidebar">
        <nav aria-label="Documentation">
          {NAV.map((group) => (
            <section key={group.heading}>
              <h2>{group.heading}</h2>
              {group.links.map(([label, id]) => <a key={id} href={`#${id}`}>{label}</a>)}
            </section>
          ))}
        </nav>
        <a className="docs-sidebar-live" href="https://laserbuddy.vercel.app/" target="_blank" rel="noreferrer">
          <span /> View Laser Buddy live <b aria-hidden="true">↗</b>
        </a>
      </aside>
      <main className="docs-content">{children}</main>
      <aside className="docs-toc" aria-label="On this page">
        <strong>On this page</strong>
        <a href="#installation">Installation</a>
        <a href="#first-circuit">Build your first circuit</a>
        <a href="#workspace">3D workspace</a>
        <a href="#troubleshooting">Troubleshooting</a>
      </aside>
    </div>
  );
}
