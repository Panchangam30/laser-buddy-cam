import { DocsLayout } from "./layout";
import { useEffect, useState, type ReactNode } from "react";
import { SiteFooter } from "../components/SiteFooter";

function Code({ children, label = "Terminal" }: { children: string; label?: string }) {
  const [status, setStatus] = useState("Copy");
  async function copy() {
    try { await navigator.clipboard.writeText(children); setStatus("Copied"); }
    catch { setStatus("Select code to copy"); }
  }
  return <div className="docs-code"><div className="docs-code-header"><span>{label}</span><button onClick={copy} aria-label={`Copy ${label.toLowerCase()} code`}>{status}</button><span className="docs-sr-only" role="status">{status === "Copy" ? "" : status}</span></div><pre><code>{children}</code></pre></div>;
}

function Callout({ title, children, tone = "info" }: {
  title: string; children: ReactNode; tone?: "info" | "warning";
}) {
  return <aside className={`docs-callout ${tone}`}><strong>{title}</strong><div>{children}</div></aside>;
}

export function DocsPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Documentation · Laser Buddy Cam";
    return () => { document.title = previous; };
  }, []);

  return (
    <DocsLayout>
      <article className="docs-article">
        <section id="introduction" className="docs-hero">
          <span className="docs-eyebrow">GETTING STARTED</span>
          <h1>Laser Buddy Cam</h1>
          <p className="docs-lead">Set up your workbench, plan an Arduino circuit, and check your wiring with the camera and 3D board. Start here for installation, controls, and hardware setup.</p>
          <div className="docs-actions"><a className="primary" href="https://laserbuddy.vercel.app/" target="_blank" rel="noreferrer">Open the live project ↗</a><a href="#installation">Install locally</a><a href="#first-circuit">Build your first circuit →</a></div>
        </section>

        <section>
          <h2>What you need</h2>
          <div className="docs-cards">
            <div><span>01</span><h3>Computer and camera</h3><p>macOS, Linux, or Windows with Python 3, Node.js, npm, and a webcam.</p></div>
            <div><span>02</span><h3>Arduino starter kit</h3><p>An Uno R3, breadboard, jumper wires, LEDs, resistors, and other common kit parts.</p></div>
            <div><span>03</span><h3>API access</h3><p>An OpenAI API key is required for bench scanning. xAI is optional for speech and live Grok voice.</p></div>
          </div>
        </section>

        <section id="installation">
          <span className="docs-eyebrow">INSTALLATION</span><h2>Run it locally<a className="docs-heading-anchor" href="#installation" aria-label="Link to Run it locally">#</a></h2>
          <p>From the repository root, create the Python environment, install both sets of dependencies, and create your local environment file.</p>
          <Code>{`python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
cd web
npm install
npm run dev`}</Code>
          <p>Open <a href="http://localhost:5173">http://localhost:5173</a>. The command starts three services:</p>
          <div className="docs-table"><table><thead><tr><th>Service</th><th>Address</th><th>Purpose</th></tr></thead><tbody>
            <tr><td>Web app</td><td><code>:5173</code></td><td>Camera, controls, and 3D workspace</td></tr>
            <tr><td>Node API</td><td><code>:8787</code></td><td>Keeps API keys out of the browser</td></tr>
            <tr><td>Vision service</td><td><code>:8788</code></td><td>OpenCV board detection and part tracking</td></tr>
          </tbody></table></div>
          <Callout title="Keep keys on the server">Edit the root <code>.env</code> file. Never place API keys in <code>web/src</code> or variables prefixed with <code>VITE_</code>, because those values can be exposed to the browser.</Callout>
        </section>

        <section id="first-circuit">
          <span className="docs-eyebrow">QUICK START</span><h2>Build your first circuit<a className="docs-heading-anchor" href="#first-circuit" aria-label="Link to Build your first circuit">#</a></h2>
          <ol className="docs-steps">
            <li><span>1</span><div><h3>Arrange the parts</h3><p>Place the breadboard, Uno, and loose components under the camera. Keep parts separated and make the printed breadboard numbers visible.</p></div></li>
            <li><span>2</span><div><h3>Allow camera access</h3><p>When the browser asks, choose Allow. If access was previously blocked, use the site controls in the address bar and reload.</p></div></li>
            <li><span>3</span><div><h3>Scan the bench</h3><p>Capture a frame. The app lists detected parts and replaces the example circuit with an assembly plan based on what it can identify.</p></div></li>
            <li><span>4</span><div><h3>Follow the steps</h3><p>Select a step on the left. Use the 3D view to check part orientation and hole placement, then move forward with Next.</p></div></li>
            <li><span>5</span><div><h3>Check before power</h3><p>Turn on board tracking and open My board to find missing or misplaced parts. Confirm LED and capacitor polarity before connecting power.</p></div></li>
          </ol>
        </section>

        <section id="camera">
          <span className="docs-eyebrow">USING THE APP</span><h2>Camera and planning<a className="docs-heading-anchor" href="#camera" aria-label="Link to Camera and planning">#</a></h2>
          <p>The initial capture is sent through the Node API to create a plan. The model identifies visible component types and markings; the application converts the returned breadboard hole names into exact 3D positions.</p>
          <ul><li>Use bright, even lighting and avoid glare on the breadboard.</li><li>Keep component bodies from touching one another.</li><li>If the inventory is wrong, rearrange the parts and scan again.</li><li>A low-confidence or unreadable label means the system could not reliably read the marking.</li></ul>
        </section>

        <section id="workspace">
          <span className="docs-eyebrow">3D WORKSPACE</span><h2>Plan and connect components<a className="docs-heading-anchor" href="#workspace" aria-label="Link to Plan and connect components">#</a></h2>
          <p>The view switch has two modes. <strong>Plan</strong> shows the target and enables the component builder. <strong>My board</strong> shows the components detected on the physical breadboard.</p>
          <h3>Place components</h3><p>In Plan mode, open <strong>Components</strong>. Click a component to place it in the center or drag it to a chosen location. Drag a placed component to move it. Select it to rotate or delete it; double-click also removes it.</p>
          <h3>Connect jumper wires</h3><ol><li>Add <strong>Jumper Wire</strong> from the Connectors category.</li><li>Select the wire. Blue connection points appear above components.</li><li>Drag each metal wire endpoint onto a blue point.</li><li>Release when the endpoint snaps into place. Moving the component now carries the connection with it.</li></ol>
          <Callout title="Plan builder versus physical tracking">The free-placement component builder is a planning tool. Live camera checks use breadboard holes and electrical nodes from the generated assembly plan.</Callout>
        </section>

        <section id="tracking">
          <span className="docs-eyebrow">LIVE TRACKING</span><h2>Check the real breadboard<a className="docs-heading-anchor" href="#tracking" aria-label="Link to Check the real breadboard">#</a></h2>
          <p><strong>Track my board</strong> sends a frame to the local vision service about twice per second. OpenCV locates the board, straightens the image, measures component endpoints, and maps them to named holes.</p>
          <p>The guidance engine compares electrical nodes rather than exact holes. For example, A20 and E20 are treated as equivalent because they share a terminal strip. Parts are reported as placed, misplaced, missing, or extra.</p>
          <p>If column 1 appears on the wrong side, use <strong>Column 1: left/right</strong>. A rectangular board looks identical after a 180° rotation, so this orientation occasionally needs manual correction.</p>
        </section>

        <section id="voice">
          <span className="docs-eyebrow">VOICE</span><h2>Talk to the teaching assistant<a className="docs-heading-anchor" href="#voice" aria-label="Link to Talk to the teaching assistant">#</a></h2>
          <p><strong>Talk to the TA</strong> starts a live session using the provider configured by <code>VOICE_PROVIDER</code>. It receives the current plan and step and can change steps, inspect a new frame, check progress, describe the board, locate a part, or point the laser at a requested hole.</p>
          <p>Grok voice uses a WebSocket audio path and may hear its own output through speakers. Headphones provide the most reliable conversation. OpenAI Realtime can be selected with <code>VOICE_PROVIDER=openai</code>.</p>
        </section>

        <section id="laser">
          <span className="docs-eyebrow">OPTIONAL HARDWARE</span><h2>Laser pointer<a className="docs-heading-anchor" href="#laser" aria-label="Link to Laser pointer">#</a></h2>
          <p>The pan/tilt head runs the firmware in <code>firmware/laserbuddy/</code>. Calibration measures where servo angles land on the board by observing the laser dot through the camera. Move either the camera or the head and you must calibrate again.</p>
          <Code>{`.venv/bin/python -m vision.service --camera 0
# In the service window: l connect · k calibrate · 1–9 aim · 0 off`}</Code>
          <Callout title="Laser safety" tone="warning">Never look into the beam or aim it at another person. The firmware turns the laser off after 15 seconds without a command; do not remove that safety timeout.</Callout>
        </section>

        <section id="configuration">
          <span className="docs-eyebrow">REFERENCE</span><h2>Configuration<a className="docs-heading-anchor" href="#configuration" aria-label="Link to Configuration">#</a></h2>
          <div className="docs-table"><table><thead><tr><th>Variable</th><th>Required</th><th>Meaning</th></tr></thead><tbody>
            <tr><td><code>OPENAI_API_KEY</code></td><td>Yes</td><td>Bench scanning and component identification</td></tr>
            <tr><td><code>OPENAI_MODEL</code></td><td>No</td><td>Vision model; defaults to the value in the example file</td></tr>
            <tr><td><code>XAI_API_KEY</code></td><td>No</td><td>Grok speech and realtime voice</td></tr>
            <tr><td><code>VOICE_PROVIDER</code></td><td>No</td><td><code>grok</code> or <code>openai</code></td></tr>
            <tr><td><code>CAMERA_INDEX</code></td><td>No</td><td>Camera number used by standalone Python tools</td></tr>
            <tr><td><code>VISION_PORT</code></td><td>No</td><td>Vision HTTP port; default <code>8788</code></td></tr>
            <tr><td><code>VISION_URL</code></td><td>No</td><td>Address used by the Node API to reach vision</td></tr>
          </tbody></table></div>
        </section>

        <section id="architecture">
          <span className="docs-eyebrow">ARCHITECTURE</span><h2>How the pieces communicate<a className="docs-heading-anchor" href="#architecture" aria-label="Link to How the pieces communicate">#</a></h2>
          <Code label="Service architecture">{`Browser camera
  └─> Node API :8787
       ├─> OpenAI / xAI
       └─> Vision service :8788
            ├─ board pose and hole map
            ├─ component tracking
            └─ laser calibration and aiming

World snapshot ─> 3D scene ─> guidance and voice tools`}</Code>
          <p>The board geometry exists in both <code>vision/geometry.py</code> and <code>web/src/lib/breadboard.ts</code>. Keep them synchronized when changing dimensions or hole layout.</p>
        </section>

        <section id="troubleshooting">
          <span className="docs-eyebrow">TROUBLESHOOTING</span><h2>Common problems<a className="docs-heading-anchor" href="#troubleshooting" aria-label="Link to Common problems">#</a></h2>
          <div className="docs-faq">
            <details open><summary>Camera blocked</summary><p>Allow camera access in the browser’s site settings, confirm no other app is using the camera, then reload the page.</p></details>
            <details><summary>Vision service is not running</summary><p>Run <code>npm run dev</code> from <code>web/</code>. If only the web server is running, start <code>.venv/bin/python -m vision.service</code> from the repository root.</p></details>
            <details><summary>API key is reported missing</summary><p>Confirm the root <code>.env</code> exists and contains a real <code>OPENAI_API_KEY</code>. Restart the development command after changing it.</p></details>
            <details><summary>Parts appear at the wrong end</summary><p>Use the Column 1 orientation button. The camera cannot always distinguish a board rotated by 180°.</p></details>
            <details><summary>The laser misses the requested hole</summary><p>Turn on board tracking and recalibrate. Recalibration is required whenever the camera, board, or laser mount moves.</p></details>
          </div>
        </section>

        <section id="limits">
          <span className="docs-eyebrow">LIMITS</span><h2>Accuracy and safety<a className="docs-heading-anchor" href="#limits" aria-label="Link to Accuracy and safety">#</a></h2>
          <ul><li>Same-colored parts that touch may be detected as one object.</li><li>A red wire lying along a red power stripe can be split by stripe removal.</li><li>Parts at the extreme board ends are less reliable.</li><li>Thin resistor leads may be invisible; placement is estimated from the body.</li><li>Always disconnect power before changing wiring.</li><li>Use current-limiting resistors for LEDs and drivers for motors and relays.</li></ul>
        </section>

        <section id="privacy">
          <span className="docs-eyebrow">LEGAL</span><h2>Privacy<a className="docs-heading-anchor" href="#privacy" aria-label="Link to Privacy">#</a></h2>
          <p>Laser Buddy uses your camera only after browser permission is granted. Camera frames are processed to identify components, generate plans, and track the breadboard. Depending on your configuration, frames or descriptions may be sent through the locally configured OpenAI or xAI services.</p>
          <p>The browser does not receive your API keys; model requests pass through the local Node server. This project does not promise storage, confidentiality, or regulatory compliance. Do not place personal, confidential, or sensitive information in the camera view.</p>
        </section>

        <section id="terms">
          <span className="docs-eyebrow">LEGAL</span><h2>Terms of use<a className="docs-heading-anchor" href="#terms" aria-label="Link to Terms of use">#</a></h2>
          <p>Laser Buddy is an educational prototype provided without warranties. Generated plans, component identification, wiring guidance, and laser positioning can be incorrect. You are responsible for reviewing every circuit before applying power and for following the specifications of your hardware.</p>
          <p>Use the project only with equipment you are authorized to operate. Never look into the laser beam, aim it at another person, bypass its safety timeout, or use it where a mistaken position could cause harm. External AI services are also subject to their own terms and privacy policies.</p>
        </section>

        <SiteFooter />
      </article>
    </DocsLayout>
  );
}
