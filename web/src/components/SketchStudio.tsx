import { useMemo, useRef, useState } from "react";
import { ArrowDownToLine, BookOpen, Check, CircleAlert, Code2, FileCode2, Play, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { reviewSketch, SKETCH_STARTERS, tokenizeSketch, type SketchReview } from "../lib/sketch";
import type { Project } from "../lib/types";
import { CodeLibrary } from "./CodeLibrary";
import { SketchLlmFeedback } from "./SketchLlmFeedback";
import { CODE_LIBRARY } from "../lib/codeLibrary";
import "./SketchStudio.css";

function readDraft(project: Project) {
  const projectCode = project.plan.artifacts?.find((artifact) => artifact.kind === "code")?.content;
  try {
    const stored = localStorage.getItem(`laser-buddy:sketch:v1:${project.id}`);
    if (stored !== null) return { code: stored, label: "Draft restored" };
  } catch { /* Editing still works when browser storage is unavailable. */ }
  return { code: projectCode ?? SKETCH_STARTERS[0].code, label: projectCode ? "From project sketch" : "Blink starter" };
}

export function SketchStudio({ project }: { project: Project }) {
  const [initial] = useState(() => readDraft(project));
  const [code, setCode] = useState(initial.code);
  const [saveStatus, setSaveStatus] = useState(initial.label);
  const [selection, setSelection] = useState("blink");
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [review, setReview] = useState<{ source: string; result: SketchReview } | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [tab, setTab] = useState("explanation");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const tokens = useMemo(() => tokenizeSketch(code), [code]);
  const lines = code.split("\n").length;
  const result = review?.source === code ? review.result : null;
  const errors = result?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const projectCode = project.plan.artifacts?.find((artifact) => artifact.kind === "code")?.content;

  function updateCode(value: string) {
    setCode(value);
    try {
      localStorage.setItem(`laser-buddy:sketch:v1:${project.id}`, value);
      setSaveStatus("Draft saved in this browser");
    } catch { setSaveStatus("Storage unavailable · download to keep your sketch"); }
  }
  function check() {
    const next = reviewSketch(code);
    setReview({ source: code, result: next });
    setTab(next.issues.some((issue) => issue.severity === "error") ? "problems" : "explanation");
  }
  function replace(value: string) {
    if (value !== code) setPendingCode(value);
  }
  function locate(line: number) {
    const field = editor.current;
    if (!field) return;
    const offset = code.split("\n").slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
    field.focus();
    field.setSelectionRange(offset, offset);
    field.scrollTop = Math.max(0, (line - 3) * 24);
    setCursor({ line, column: 1 });
  }
  function download() {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "sketch.ino";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <Dialog>
    <DialogTrigger asChild><button className="project-tool" aria-label="Sketch Studio" title="Write and review an Arduino sketch"><Code2 size={14} /><span>Code editor</span></button></DialogTrigger>
    <DialogContent className="sketch-dialog" closeLabel="Close Sketch Studio">
      <header className="sketch-header"><div><DialogTitle>Sketch Studio</DialogTitle><DialogDescription>Edit your Arduino sketch and review common issues.</DialogDescription></div></header>
      <div className="sketch-toolbar">
        <div className="sketch-starters"><button aria-pressed={libraryOpen} onClick={() => setLibraryOpen((value) => !value)}><BookOpen size={14} />Library <span>{CODE_LIBRARY.length}</span></button>{!libraryOpen && <><select aria-label="Starter sketch" value={selection} onChange={(event) => setSelection(event.target.value)}>{SKETCH_STARTERS.map((starter) => <option key={starter.id} value={starter.id}>{starter.title}</option>)}{projectCode && <option value="project">Current project sketch</option>}</select><button onClick={() => replace(selection === "project" ? projectCode! : SKETCH_STARTERS.find((starter) => starter.id === selection)!.code)}><RotateCcw size={14} />Load</button></>}</div>
        <div className="sketch-actions"><button onClick={download} title="Download Arduino sketch"><ArrowDownToLine size={15} /><span>Download .ino</span></button><button className="sketch-check" onClick={check}><Play size={14} />Check & explain</button></div>
      </div>
      {pendingCode !== null && <div className="sketch-replace" role="alert"><span>Replace this draft with the selected code?</span><button onClick={() => { updateCode(pendingCode); setPendingCode(null); setReview(null); setLibraryOpen(false); }}>Replace draft</button><button onClick={() => setPendingCode(null)}>Keep editing</button></div>}
      {libraryOpen ? <CodeLibrary onUse={(value) => { if (value === code) setLibraryOpen(false); else replace(value); }} onClose={() => setLibraryOpen(false)} /> : <div className="sketch-workspace">
        <section className="sketch-editor-pane" aria-label="Code editor">
          <div className="sketch-file"><span><FileCode2 size={15} />sketch.ino</span><small>Arduino Uno · C++</small></div>
          <div className="sketch-code-area">
            <div className="sketch-gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}</div>
            <div className="sketch-input-wrap">
              <pre ref={highlight} aria-hidden="true">{tokens.map((token, i) => <span key={i} className={`syntax-${token.kind}`}>{token.text}</span>)}{"\n"}</pre>
              <textarea ref={editor} value={code} onChange={(event) => updateCode(event.target.value)} aria-label="Arduino sketch code" spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" maxLength={40000}
                onScroll={(event) => { if (highlight.current) { highlight.current.scrollTop = event.currentTarget.scrollTop; highlight.current.scrollLeft = event.currentTarget.scrollLeft; } if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }}
                onSelect={(event) => { const preceding = code.slice(0, event.currentTarget.selectionStart).split("\n"); setCursor({ line: preceding.length, column: preceding.at(-1)!.length + 1 }); }}
                onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); check(); } }} />
            </div>
          </div>
          <div className="sketch-editor-status"><span>{saveStatus}</span><span>Ln {cursor.line}, Col {cursor.column}</span></div>
        </section>
        <aside className="sketch-review" aria-label="Sketch review">
          <Tabs value={tab} onValueChange={setTab}><TabsList aria-label="Code review views"><TabsTrigger value="explanation">What it does</TabsTrigger><TabsTrigger value="problems">Problems {result ? `(${result.issues.length})` : ""}</TabsTrigger><TabsTrigger value="llm">LLM feedback</TabsTrigger></TabsList>
            <div className="sketch-review-scroll" aria-live="polite">
              <TabsContent value="llm" forceMount hidden={tab !== "llm"}><SketchLlmFeedback code={code} projectTitle={project.name} onLocate={locate} onUse={replace} /></TabsContent>
              {tab !== "llm" && (!result ? <div className="sketch-empty"><h3>{review ? "Your code has changed." : "Code review"}</h3><p>Choose <b>Check & explain</b> for local checks, or open <b>LLM feedback</b> for a model review.</p><span className="sketch-shortcut">⌘ / Ctrl + Enter in the editor</span></div> : <>
                <TabsContent value="explanation"><div className="sketch-summary"><h3>Sketch overview</h3><p>{result.purpose}</p></div>
                  {result.pins.length > 0 && <div className="sketch-pins"><h4>Pins referenced</h4><div>{result.pins.map((pin) => <span key={pin}>{pin}</span>)}</div><small>Compare these with your wiring plan.</small></div>}
                  {result.actions.length > 0 && <div className="sketch-walkthrough"><h4>Walk through the code</h4>{result.actions.map((action, index) => <button key={index} onClick={() => locate(action.line)}><span>L{action.line}</span><p>{action.text}</p></button>)}</div>}
                </TabsContent>
                <TabsContent value="problems"><div className="sketch-summary"><h3>{errors ? `${errors} potential ${errors === 1 ? "error" : "errors"}` : "Common error checks passed"}</h3><p>{result.issues.length ? "Select an issue to jump to its line. These checks cover common patterns in simple Uno sketches." : "No common issues found. Compile in the Arduino IDE to check C++ syntax, names, types, and libraries."}</p></div>
                  {result.issues.map((issue, index) => <button className={`sketch-issue ${issue.severity}`} key={index} onClick={() => locate(issue.line)}><span><CircleAlert size={14} />{issue.severity === "error" ? "ERROR" : "TIP"} · LINE {issue.line}</span><strong>{issue.title}</strong><p>{issue.help}</p></button>)}
                  {!result.issues.length && <div className="sketch-clear"><Check size={20} />Ready for your next review in the Arduino IDE.</div>}
                </TabsContent>
              </>)}
            </div>
          </Tabs>
        </aside>
      </div>}
      <footer className="sketch-footer"><span><i />Local checks + optional LLM review</span><span>Does not compile, execute, or upload code.</span></footer>
    </DialogContent>
  </Dialog>;
}
