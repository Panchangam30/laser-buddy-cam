import { Settings2, Moon, Sun, Monitor, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { usePreferences, type Preferences } from "../lib/preferences";
import "./Settings.css";

type ToggleKey = { [K in keyof Preferences]: Preferences[K] extends boolean ? K : never }[keyof Preferences];
const boardToggles: { key: ToggleKey; label: string; description: string }[] = [
  { key: "swipeNavigation", label: "Swipe to orbit", description: "Rotate with a trackpad; pinch to zoom. Turn off to zoom by scrolling." },
  { key: "dragToPlace", label: "Drag to place", description: "Drag parts from the library onto the board." },
  { key: "labels", label: "Board labels", description: "Show detected component names in My board." },
];
const guidanceToggles: typeof boardToggles = [
  { key: "narrate", label: "Step narration", description: "Read each build step aloud when speech is available." },
  { key: "reduceMotion", label: "Reduce motion", description: "Disable interface animations and orbit smoothing." },
];
export function Settings() {
  const { preferences, update, settingsOpen, setSettingsOpen } = usePreferences();
  const renderToggle = ({ key, label, description }: typeof boardToggles[number]) => <label className="settings-row" key={key}>
    <span><strong>{label}</strong><small>{description}</small></span>
    <input type="checkbox" role="switch" aria-label={label} checked={preferences[key]} onChange={(event) => update({ [key]: event.target.checked })} />
  </label>;
  return <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
    <DialogTrigger asChild><button className="settings-trigger" aria-label="Settings" title="Settings"><Settings2 size={17} /><span>Settings</span></button></DialogTrigger>
    <DialogContent className="settings-dialog" closeLabel="Close settings">
      <div className="settings-heading"><span className="settings-eyebrow"><SlidersHorizontal size={14} />WORKBENCH</span>
        <DialogTitle>Workbench settings</DialogTitle>
        <DialogDescription>Display, board controls, and build guidance.</DialogDescription>
      </div>
      <div className="settings-body">
        <section className="settings-section" aria-label="Appearance"><h3>Appearance</h3>
          <div className="theme-options" role="group" aria-label="Color theme">
            {([{ value: "dark", label: "Dark", Icon: Moon }, { value: "light", label: "Light", Icon: Sun }, { value: "system", label: "System", Icon: Monitor }] as const).map(({ value, label, Icon }) =>
              <button key={value} aria-pressed={preferences.theme === value} onClick={() => update({ theme: value })}><Icon size={18} />{label}<span className="theme-indicator" /></button>)}
          </div>
          <label className="settings-row settings-select-row"><span><strong>3D rendering</strong><small>Low power uses fewer pixels and removes shadows.</small></span>
            <select aria-label="3D rendering" value={preferences.renderQuality} onChange={(event) => update({ renderQuality: event.target.value as Preferences["renderQuality"] })}><option value="standard">Standard</option><option value="low">Low power</option></select>
          </label>
        </section>
        <section className="settings-section" aria-label="Board controls"><h3>Board controls</h3>
          <label className="settings-row settings-select-row"><span><strong>Orbit sensitivity</strong><small>Rotation speed for trackpad swipes and dragging.</small></span>
            <select aria-label="Orbit sensitivity" value={preferences.orbitSensitivity} onChange={(event) => update({ orbitSensitivity: event.target.value as Preferences["orbitSensitivity"] })}><option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option></select>
          </label>
          {boardToggles.map(renderToggle)}
        </section>
        <section className="settings-section" aria-label="Build guidance"><h3>Build guidance</h3>{guidanceToggles.map(renderToggle)}</section>
      </div>

    </DialogContent>
  </Dialog>;
}
