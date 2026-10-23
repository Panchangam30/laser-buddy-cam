import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Preferences = {
  theme: "dark" | "light" | "system";
  orbitSensitivity: "slow" | "normal" | "fast";
  renderQuality: "standard" | "low";
  narrate: boolean;
  labels: boolean;
  reduceMotion: boolean;
  dragToPlace: boolean;
  swipeNavigation: boolean;
};
export const PREFERENCES_KEY = "laser-buddy:preferences:v1";
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark", orbitSensitivity: "normal", renderQuality: "standard", narrate: false, labels: true, reduceMotion: false, dragToPlace: false, swipeNavigation: true,
};
function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_PREFERENCES;
    const next = { ...DEFAULT_PREFERENCES };
    if (["dark", "light", "system"].includes(saved.theme)) next.theme = saved.theme;
    if (["slow", "normal", "fast"].includes(saved.orbitSensitivity)) next.orbitSensitivity = saved.orbitSensitivity;
    if (["standard", "low"].includes(saved.renderQuality)) next.renderQuality = saved.renderQuality;
    for (const key of ["narrate", "labels", "reduceMotion", "dragToPlace", "swipeNavigation"] as const) {
      if (typeof saved[key] === "boolean") next[key] = saved[key];
    }
    return next;
  } catch { return DEFAULT_PREFERENCES; }
}
const PreferencesContext = createContext<{
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
  reset: () => void;
  saved: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
} | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [saved, setSaved] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); setSaved(true); }
    catch { setSaved(false); }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = preferences.theme === "system" ? (media.matches ? "dark" : "light") : preferences.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#14171c" : "#f5f6f8");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences]);
  return <PreferencesContext value={{ preferences, saved, settingsOpen, setSettingsOpen,
    update: (patch) => setPreferences((current) => ({ ...current, ...patch })),
    reset: () => setPreferences({ ...DEFAULT_PREFERENCES }),
  }}>{children}</PreferencesContext>;
}
export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("PreferencesProvider is required");
  return value;
}
