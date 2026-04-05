import { type FC, useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";

// Matches the Rust AppSettings struct (snake_case)
interface AppSettings {
  hook_port: number;
  terminal_font_size: number;
  terminal_theme: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  hook_port: 7837,
  terminal_font_size: 14,
  terminal_theme: "system",
};

const Settings: FC = () => {
  const navigateToPicker = useAppStore((s) => s.navigateToPicker);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await invoke<AppSettings>("get_app_settings");
        if (!cancelled) setSettings(data);
      } catch {
        // Use defaults if backend not available
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await invoke("update_app_settings", { settings });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const updateField = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-950">
        <p className="text-sm text-neutral-500">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-950">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <button
          type="button"
          onClick={navigateToPicker}
          className="rounded px-2 py-1 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          title="Back to projects"
        >
          &larr;
        </button>
        <h1 className="text-sm font-semibold text-neutral-100">Settings</h1>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
          {/* Hook Server Port */}
          <div>
            <label
              htmlFor="hook-port"
              className="mb-1 block text-sm font-medium text-neutral-300"
            >
              Hook Server Port
            </label>
            <input
              id="hook-port"
              type="number"
              min={1024}
              max={65535}
              value={settings.hook_port}
              onChange={(e) =>
                updateField("hook_port", Number(e.target.value))
              }
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Port for the local HTTP hook server (default: 7837)
            </p>
          </div>

          {/* Terminal Font Size */}
          <div>
            <label
              htmlFor="font-size"
              className="mb-1 block text-sm font-medium text-neutral-300"
            >
              Terminal Font Size
            </label>
            <input
              id="font-size"
              type="number"
              min={8}
              max={32}
              value={settings.terminal_font_size}
              onChange={(e) =>
                updateField("terminal_font_size", Number(e.target.value))
              }
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Font size for terminal sessions (default: 14)
            </p>
          </div>

          {/* Terminal Theme */}
          <div>
            <label
              htmlFor="theme"
              className="mb-1 block text-sm font-medium text-neutral-300"
            >
              Terminal Theme
            </label>
            <select
              id="theme"
              value={settings.terminal_theme}
              onChange={(e) =>
                updateField(
                  "terminal_theme",
                  e.target.value,
                )
              }
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              Color theme for terminal sessions
            </p>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
            {success && (
              <span className="text-xs text-green-400">Settings saved</span>
            )}
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
