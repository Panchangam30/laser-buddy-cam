import type { Project } from "./types";
import { normalizeProject } from "./plans";

const DB_NAME = "laser-buddy";
const DB_VERSION = 1;
const STORE = "projects";
const LAST_KEY = "laser-buddy:last-project";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open project storage."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Project storage failed."));
  });
}

export async function listProjects(): Promise<Project[]> {
  const db = await openDb();
  try {
    const raw = await requestResult(db.transaction(STORE).objectStore(STORE).getAll());
    return raw.flatMap((item) => {
      try { return [normalizeProject(item)]; } catch { return []; }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await requestResult(tx.objectStore(STORE).put(project));
    localStorage.setItem(LAST_KEY, project.id);
  } finally {
    db.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await requestResult(tx.objectStore(STORE).delete(id));
    if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY);
  } finally {
    db.close();
  }
}

export async function loadLastProject(): Promise<Project | null> {
  const projects = await listProjects();
  const id = localStorage.getItem(LAST_KEY);
  return projects.find((project) => project.id === id) ?? projects[0] ?? null;
}
