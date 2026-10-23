import { Settings2, Moon, Sun, Monitor, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { usePreferences, type Preferences } from "../lib/preferences";
import "./Settings.css";

const toggles: { key: Exclude<keyof Preferences, "theme">; label: string; description: string }[] = [
  { key: "swipeNavigation", label: "Swipe to orbit", description: "Use trackpad scrolling to rotate the board. Pinch to zoom; switch off for scroll-to-zoom." },
  { key: "narrate", label: "Step narration", description: "Read build instructions aloud when narration is available." },
  { key: "labels", label: "Board labels", description: "Show component labels in the My board view." },
  { key: "reduceMotion", label: "Reduce motion", description: "Limit interface animation and smooth scrolling." },
  { key: "dragToPlace", label: "Drag to place", description: "Enable precise drag placement from the library. Tap to add always works." },
];
export function Settings() {
  const { preferences, update, reset, saved, settingsOpen, setSettingsOpen } = usePreferences();
  return <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
    <DialogTrigger asChild><button className="settings-trigger" aria-label="Settings" title="Settings"><Settings2 size={17} /><span>Settings</span></button></DialogTrigger>
    <DialogContent className="settings-dialog" closeLabel="Close settings">
      <div className="settings-heading"><span className="settings-eyebrow"><SlidersHorizontal size={14} />MAKE IT YOURS</span>
        <DialogTitle>Workbench settings</DialogTitle>
        <DialogDescription>A calmer space to build, tuned to the way you work.</DialogDescription>
      </div>
      <section className="settings-section" aria-label="Appearance"><h3>Appearance</h3>
        <div className="theme-options" role="group" aria-label="Color theme">
          {([{ value: "dark", label: "Dark", Icon: Moon }, { value: "light", label: "Light", Icon: Sun }, { value: "system", label: "System", Icon: Monitor }] as const).map(({ value, label, Icon }) =>
            <button key={value} aria-pressed={preferences.theme === value} onClick={() => update({ theme: value })}><Icon size={20} />{label}</button>)}
        </div>
      </section>
      <section className="settings-section" aria-label="Interaction"><h3>Interaction & guidance</h3>
        {toggles.map(({ key, label, description }) => <label className="settings-row" key={key}>
          <span><strong>{label}</strong><small>{description}</small></span>
          <input type="checkbox" role="switch" checked={preferences[key]} onChange={(event) => update({ [key]: event.target.checked })} />
        </label>)}
      </section>
      <footer className="settings-footer"><span role="status">{saved ? "Saved automatically · This browser only" : "Using this session · Browser storage unavailable"}</span><button onClick={reset}>Reset settings</button></footer>
    </DialogContent>
  </Dialog>;
}
