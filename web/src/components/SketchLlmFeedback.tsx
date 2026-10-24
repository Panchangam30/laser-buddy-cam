import { useEffect, useRef, useState } from "react";
import { requestSketchFeedback } from "../lib/api";
import type { SketchFeedback } from "../lib/sketchFeedback";

export function SketchLlmFeedback({ code, projectTitle, onLocate, onUse }: {
  code: string; projectTitle: string; onLocate: (line: number) => void; onUse: (code: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; question: string; message: string } | null>(null);
  const [answer, setAnswer] = useState<{ code: string; question: string; projectTitle: string; feedback: SketchFeedback; model: string } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const current = answer?.code === code && answer.question === question && answer.projectTitle === projectTitle ? answer : null;
  useEffect(() => { pending.current?.abort(); }, [code, projectTitle]);
  useEffect(() => () => pending.current?.abort(), []);

  async function review() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError(null);
    try {
      const result = await requestSketchFeedback(code, question, projectTitle, controller.signal);
      if (!controller.signal.aborted) setAnswer({ code, question, projectTitle, ...result });
    } catch (cause) {
      if (!controller.signal.aborted) setError({ code, question, message: cause instanceof Error ? cause.message : "Could not review this sketch." });
    } finally {
      if (pending.current === controller) setBusy(false);
    }
  }
  return <div className="sketch-llm">
    <div className="sketch-summary"><h3>LLM feedback</h3><p>Get a deeper explanation, find logic problems, or ask how to change your sketch.</p></div>
    <label className="sketch-question">Goal or question (optional)<textarea value={question} maxLength={2000} rows={3} placeholder="I want the button to toggle the LED. Does this code do that?" onChange={(event) => { pending.current?.abort(); setBusy(false); setError(null); setQuestion(event.target.value); }} /></label>
    <div className="sketch-llm-actions"><button onClick={() => void review()} disabled={busy || !code.trim()}>{busy ? "Reviewing…" : "Review with LLM"}</button>{busy && <button onClick={() => { pending.current?.abort(); setBusy(false); }}>Cancel review</button>}</div>
    <p className="sketch-llm-note">Sends this sketch, your question, and the project title to Groq through the local API. Uses the configured Groq API key.</p>
    {error?.code === code && error.question === question && <p className="sketch-llm-error" role="alert">{error.message}</p>}
    <div aria-live="polite">{busy && <p className="sketch-llm-note" role="status">Reading the sketch and preparing feedback…</p>}{!current && answer && <p className="sketch-llm-note">The code, question, or project changed. Request a new review for this version.</p>}</div>
    {current && <div className="sketch-llm-answer"><span className="sketch-llm-model">Reviewed via Groq · {current.model}</span><h4>Summary</h4><p>{current.feedback.summary}</p>
      {current.feedback.explanation.length > 0 && <><h4>How it works</h4><div className="sketch-walkthrough">{current.feedback.explanation.map((entry, index) => entry.line === null ? <p key={index}>{entry.text}</p> : <button key={index} onClick={() => onLocate(entry.line!)}><span>L{entry.line}</span><p>{entry.text}</p></button>)}</div></>}
      {current.feedback.issues.length > 0 && <><h4>Feedback</h4>{current.feedback.issues.map((issue, index) => <article className={`sketch-issue ${issue.severity}`} key={index}><span>{issue.severity.toUpperCase()}{issue.line && <button onClick={() => onLocate(issue.line!)}>Line {issue.line}</button>}</span><strong>{issue.title}</strong><p>{issue.explanation}</p><p>{issue.suggestion}</p></article>)}</>}
      {current.feedback.nextSteps.length > 0 && <><h4>Next steps</h4><ol>{current.feedback.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol></>}
      {current.feedback.suggestedCode !== null && <details className="sketch-suggestion"><summary>Suggested revision</summary><pre>{current.feedback.suggestedCode}</pre><button onClick={() => onUse(current.feedback.suggestedCode!)}>Use suggestion</button></details>}
      <p className="sketch-llm-note">Model feedback can be wrong. Compile and test changes in the Arduino IDE; this review does not run the sketch.</p>
    </div>}
  </div>;
}
