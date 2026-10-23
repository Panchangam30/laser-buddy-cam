import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import { CODE_CATEGORIES, CODE_LIBRARY, type CodeExample } from "../lib/codeLibrary";
import { tokenizeSketch } from "../lib/sketch";

export function CodeLibrary({ onUse, onClose }: { onUse: (code: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<CodeExample | null>(null);
  const results = useMemo(() => CODE_LIBRARY.filter((example) => (category === "all" || category === example.category) && query.toLowerCase().trim().split(/\s+/).every((word) => `${example.title} ${example.description} ${example.category} ${example.parts.join(" ")}`.toLowerCase().includes(word))), [query, category]);
  return <section className="code-library" aria-label="Starter code library">
    <div className="code-library-heading"><div><h3>Code library</h3><p>{CODE_LIBRARY.length} Arduino Uno example sketches.</p></div><button onClick={onClose}><ArrowLeft size={14} />Back to editor</button></div>
    <div className="code-library-filters"><label><Search size={14} /><input type="search" aria-label="Search code library" placeholder="Search projects or parts" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Code library category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{CODE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select><span>{results.length} results</span></div>
    <div className="code-library-layout">
      <div className="code-library-results">{results.length ? results.map((example) => <article className={`code-library-item ${selected?.id === example.id ? "selected" : ""}`} key={example.id}><small>{example.category}</small><h4>{example.title}</h4><p>{example.description}</p><div><button aria-label={`Explain ${example.title}`} onClick={() => setSelected(example)}>Explain</button><button aria-label={`Use ${example.title}`} onClick={() => onUse(example.code)}>Use sketch</button></div></article>) : <div className="code-library-empty"><p>No matching sketches.</p><button onClick={() => { setQuery(""); setCategory("all"); }}>Clear filters</button></div>}</div>
      <div className="code-library-detail" aria-label="Starter explanation" aria-live="polite">{selected ? <><div className="code-library-detail-heading"><span>{selected.category}</span><h3>{selected.title}</h3><p>{selected.description}</p><button onClick={() => onUse(selected.code)}>Use this sketch</button></div><h4>How it works</h4><ol>{selected.explanation.map((step) => <li key={step}>{step}</li>)}</ol><h4>What to expect</h4><p>{selected.expected}</p><h4>Parts and setup</h4><ul>{selected.parts.map((part) => <li key={part}>{part}</li>)}</ul><h4>Starter code</h4><pre>{tokenizeSketch(selected.code).map((token, index) => <span key={index} className={`syntax-${token.kind}`}>{token.text}</span>)}</pre><p className="code-library-note">Loading code changes your editor draft. Check the pin assignments against your circuit before uploading.</p></> : <div className="code-library-placeholder"><BookOpen size={24} /><h3>Choose a project</h3><p>Select Explain to read the setup, behavior, and code. Use sketch opens a copy in your editor.</p></div>}</div>
    </div>
  </section>;
}
