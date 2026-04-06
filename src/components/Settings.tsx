import { type FC, useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { useThemeStore } from "../stores/themeStore";

// Matches the Rust AppSettings struct (snake_case)
interface AppSettings {
  hook_port: number;
  terminal_font_size: number;
  terminal_theme: string;
  app_theme: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  hook_port: 7837,
  terminal_font_size: 14,
  terminal_theme: "system",
  app_theme: "system",
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
      // Mirror theme to localStorage for flash-prevention script
      try {
        localStorage.setItem("seance-theme", settings.app_theme);
      } catch {
        // localStorage may be full — flash-prevention script will fall back to matchMedia
      }
      // Sync terminal theme to the store
      useThemeStore
        .getState()
        .setTerminalTheme(
          settings.terminal_theme as "system" | "dark" | "light",
        );
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
      <div className="flex h-screen items-center justify-center bg-bg">
        <p className="text-sm text-text-muted">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={navigateToPicker}
          className="rounded px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-interactive-hover hover:text-text-hover"
          title="Back to projects"
        >
          &larr;
        </button>
        <h1 className="text-sm font-semibold text-text">Settings</h1>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
          {/* App Theme */}
          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">
              App Theme
            </label>
            <div className="flex gap-1 rounded-md border border-border-input bg-surface p-1">
              {(["system", "dark", "light"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    updateField("app_theme", option);
                    useThemeStore
                      .getState()
                      .setPreference(option);
                  }}
                  className={`flex-1 rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                    settings.app_theme === option
                      ? "bg-btn-primary-bg text-btn-primary-text"
                      : "text-text-secondary hover:text-text-hover"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Appearance for the app UI (default: system)
            </p>
          </div>

          {/* Hook Server Port */}
          <div>
            <label
              htmlFor="hook-port"
              className="mb-1 block text-sm font-medium text-text-secondary"
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
              className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-ring-focus"
            />
            <p className="mt-1 text-xs text-text-muted">
              Port for the local HTTP hook server (default: 7837)
            </p>
          </div>

          {/* Terminal Font Size */}
          <div>
            <label
              htmlFor="font-size"
              className="mb-1 block text-sm font-medium text-text-secondary"
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
              className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-ring-focus"
            />
            <p className="mt-1 text-xs text-text-muted">
              Font size for terminal sessions (default: 14)
            </p>
          </div>

          {/* Terminal Theme */}
          <div>
            <label
              htmlFor="theme"
              className="mb-1 block text-sm font-medium text-text-secondary"
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
              className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-ring-focus"
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
            <p className="mt-1 text-xs text-text-muted">
              Color theme for terminal sessions
            </p>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-btn-primary-bg px-4 py-2 text-sm font-medium text-btn-primary-text transition-colors hover:bg-btn-primary-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
            {success && (
              <span className="text-xs text-green-700 dark:text-green-400">Settings saved</span>
            )}
            {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
