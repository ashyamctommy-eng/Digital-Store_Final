"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminGetSettings,
  adminSaveSettings,
  adminTestIntegration,
  setAdminKey,
  type IntegrationTestResult,
  type SettingField,
  type SettingGroup,
  type SettingsResponse,
} from "@/lib/adminApi";

/**
 * Configurations — the super-admin surface.
 *
 * Gateway keys used to mean editing `api/config.php` over SSH. They are pasted
 * here instead, validated, and stored server-side; the browser only ever sees a
 * masked hint, and a saved secret is never sent back.
 *
 * The whole form renders from the server's schema, so the labels, hints and
 * validation messages all come from one place and cannot drift from the settings
 * the backend actually accepts.
 *
 * Two deliberate omissions: `admin_api_key` and `data_dir` are not editable
 * here. The admin key is what authorises this page — a bad save would lock you
 * out of the only tool that could undo it — and both stay recoverable by hand in
 * `config.php`.
 */

/** Which integration's "Test connection" belongs to a group. */
const GROUP_TEST: Record<string, "palplus" | "nowpayments" | "resend" | "smsotp" | "proxycheck"> = {
  palplus: "palplus",
  nowpayments: "nowpayments",
  resend: "resend",
  smsotp: "smsotp",
  proxycheck: "proxycheck",
};

export default function AdminConfigurationsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState("");
  const [testResults, setTestResults] = useState<Record<string, IntegrationTestResult>>({});
  const [keyDraft, setKeyDraft] = useState("");
  const [needsKey, setNeedsKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminGetSettings();
    setLoading(false);
    if (res.ok && res.data) {
      setData(res.data);
      setError("");
      setNeedsKey(false);
      return;
    }
    if (res.status === 401) {
      setNeedsKey(true);
      setError("");
      return;
    }
    if (res.status === 503) {
      setError(
        "admin_api_key is not set in api/config.php yet. Set it on the server, then reload."
      );
      return;
    }
    setError(res.error ?? "Could not load the configuration.");
  }, []);

  useEffect(() => {
    let cancelled = false;
    adminGetSettings().then((res) => {
      if (cancelled) return;
      if (res.ok && res.data) {
        setData(res.data);
        return;
      }
      if (res.status === 401) setNeedsKey(true);
      else if (res.status === 503) {
        setError(
          "admin_api_key is not set in api/config.php yet. Set it on the server, then reload."
        );
      } else setError(res.error ?? "Could not load the configuration.");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirtyKeys = useMemo(() => Object.keys(draft), [draft]);

  const setField = useCallback((key: string, value: string | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    if (!dirtyKeys.length) return;
    setSaving(true);
    setFieldErrors({});
    const res = await adminSaveSettings(draft);
    setSaving(false);

    if (!res.ok) {
      const errors =
        (res as unknown as { fieldErrors?: Record<string, string> }).fieldErrors ?? {};
      setFieldErrors(errors);
      setToast(
        Object.keys(errors).length
          ? "Some values were rejected — nothing was saved."
          : (res.error ?? "Could not save.")
      );
      return;
    }

    setDraft({});
    setToast(
      `Saved ${res.data?.saved.length ?? 0} setting(s)${
        res.data?.cleared.length ? `, cleared ${res.data.cleared.length}` : ""
      }.`
    );
    if (res.data?.groups) {
      setData((prev) =>
        prev
          ? { ...prev, groups: res.data!.groups, checklist: res.data!.checklist }
          : prev
      );
    }
    setTimeout(() => setToast(""), 4000);
  }, [draft, dirtyKeys.length]);

  const runTest = useCallback(async (id: string) => {
    const integration = GROUP_TEST[id];
    if (!integration) return;
    setTesting(integration);
    const res = await adminTestIntegration(integration);
    setTesting("");
    if (res.ok && res.data) {
      setTestResults((prev) => ({ ...prev, [integration]: res.data as IntegrationTestResult }));
      return;
    }
    setTestResults((prev) => ({
      ...prev,
      [integration]: {
        integration,
        checks: [],
        ok: false,
        error: res.error ?? "Could not run the test.",
      },
    }));
  }, []);

  const card =
    "bg-[var(--color-panel)] rounded-2xl border border-[var(--color-line)] p-5";
  const input =
    "w-full px-3 py-2 rounded-xl bg-[var(--color-page)] border border-[var(--color-line)] text-sm focus:outline-none focus:border-[var(--color-brand)]";

  /* ----------------------------------------------------------- admin key gate */
  if (needsKey) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-extrabold mb-1">Configurations</h1>
        <p className="text-sm text-[var(--color-ink-soft)] mb-5">
          Enter the admin key from <code>api/config.php</code> to manage gateway
          credentials.
        </p>
        <div className={card}>
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="Paste the admin_api_key"
            autoComplete="off"
            className={input}
          />
          <button
            type="button"
            onClick={() => {
              setAdminKey(keyDraft.trim());
              setNeedsKey(false);
              void load();
            }}
            disabled={keyDraft.trim() === ""}
            className="mt-3 w-full px-4 py-2.5 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-sm font-bold transition-colors disabled:opacity-50"
          >
            Unlock
          </button>
          <p className="text-[11px] text-[var(--color-ink-faint)] mt-3 leading-relaxed">
            Kept in this browser tab only. It is a shared secret, not a user
            account — anyone with it can change these settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Configurations</h1>
          <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">
            Gateway credentials, email and provider settings
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirtyKeys.length > 0 && (
            <span className="text-[11px] font-bold text-[var(--color-warning)]">
              {dirtyKeys.length} unsaved
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || dirtyKeys.length === 0}
            className="px-4 py-2 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-strong)] text-white text-sm font-bold transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-5 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded-xl p-3.5 leading-relaxed">
          {error}
        </p>
      )}

      {toast && (
        <p className="mb-5 text-[12px] text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/25 rounded-xl p-3.5">
          {toast}
        </p>
      )}

      {loading && !data && (
        <p className="text-sm text-[var(--color-ink-faint)] animate-pulse">
          Loading configuration…
        </p>
      )}

      {data && (
        <div className="space-y-5 max-w-3xl">
          {/* Setup checklist — derived from real state, never hard-coded. */}
          <div className={card}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
                Before you take money
              </h2>
              <span
                className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${
                  data.checklist.ready_for_payments
                    ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                    : "bg-[var(--color-warning)]/15 text-[var(--color-warning)]"
                }`}
              >
                {data.checklist.ready_for_payments
                  ? "ready"
                  : `${data.checklist.blocking.length} blocking`}
              </span>
            </div>
            <ul className="space-y-2">
              {data.checklist.items.map((item) => (
                <li key={item.id} className="flex items-start gap-2.5">
                  <span
                    className={`shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white ${
                      item.done ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"
                    }`}
                  >
                    {item.done ? "✓" : "!"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold">
                      {item.label}
                      {item.blocking && !item.done && (
                        <span className="ml-2 text-[9px] font-extrabold uppercase tracking-wider text-[var(--color-danger)]">
                          blocking
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-[var(--color-ink-soft)] leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {data.groups.map((group: SettingGroup) => {
            const test = GROUP_TEST[group.id];
            const result = test ? testResults[test] : undefined;
            const visible = group.fields.filter((f) => showAdvanced || !f.advanced);

            if (group.id === "advanced" && !showAdvanced) return null;
            if (visible.length === 0) return null;

            return (
              <div key={group.id} className={card}>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
                      {group.label}
                    </h2>
                    <p className="text-[11px] text-[var(--color-ink-faint)] mt-0.5">
                      {group.blurb}
                    </p>
                  </div>
                  {test && (
                    <button
                      type="button"
                      onClick={() => runTest(group.id)}
                      disabled={testing !== ""}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-line)] text-[11px] font-bold hover:border-[var(--color-brand)] transition-colors disabled:opacity-50"
                    >
                      {testing === test ? "Testing…" : "Test connection"}
                    </button>
                  )}
                </div>

                {result && (
                  <div className="mb-4 rounded-xl border border-[var(--color-line)] p-3">
                    {result.error && !result.checks.length && (
                      <p className="text-[11px] text-[var(--color-warning)] leading-relaxed">
                        {result.error}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {result.checks.map((check, i) => (
                        <li key={`${check.label}-${i}`} className="flex items-start gap-2">
                          <span
                            className={`shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-black text-white ${
                              check.ok ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"
                            }`}
                          >
                            {check.ok ? "✓" : "✕"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold">{check.label}</p>
                            {check.detail && (
                              <p className="text-[10px] text-[var(--color-ink-soft)] leading-relaxed break-words">
                                {check.detail}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-4">
                  {visible.map((field: SettingField) => (
                    <Field
                      key={field.key}
                      field={field}
                      draft={draft}
                      error={fieldErrors[field.key]}
                      onChange={setField}
                      inputClass={input}
                    />
                  ))}
                  {group.fields.some((f) => f.advanced) && !showAdvanced && group.id !== "advanced" && (
                    <p className="text-[10px] text-[var(--color-ink-faint)]">
                      Advanced options for this section are hidden.
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          <div className={card}>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={showAdvanced}
                onChange={(e) => setShowAdvanced(e.target.checked)}
                className="w-4 h-4 accent-[var(--color-brand)]"
              />
              <span className="text-[12px] font-bold">
                Show advanced options
              </span>
            </label>
            <p className="text-[11px] text-[var(--color-ink-faint)] mt-2 leading-relaxed">
              <code>admin_api_key</code> and <code>data_dir</code> are not
              editable here on purpose: the admin key is what authorises this
              page, so a bad value would lock you out. Edit them in{" "}
              <code>api/config.php</code> on the server if you need to change
              them.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** One setting input, rendered from the server's field description. */
function Field({
  field,
  draft,
  error,
  onChange,
  inputClass,
}: {
  field: SettingField;
  draft: Record<string, string | boolean>;
  error?: string;
  onChange: (key: string, value: string | boolean) => void;
  inputClass: string;
}) {
  const isDirty = Object.prototype.hasOwnProperty.call(draft, field.key);
  const draftValue = draft[field.key];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <label className="text-[12px] font-bold">
          {field.label}
          {field.required && <span className="ml-1 text-[var(--color-brand)]">*</span>}
        </label>
        <span className="text-[10px] text-[var(--color-ink-faint)]">
          {isDirty
            ? "edited"
            : field.is_set
              ? field.source === "console"
                ? "saved here"
                : "from config.php"
              : "not set"}
        </span>
      </div>

      {field.type === "bool" ? (
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={
              isDirty ? Boolean(draftValue) : Boolean(field.value)
            }
            onChange={(e) => onChange(field.key, e.target.checked)}
            className="w-4 h-4 accent-[var(--color-brand)]"
          />
          <span className="text-[11px] text-[var(--color-ink-soft)]">
            {field.is_set || isDirty ? "enabled" : "disabled"}
          </span>
        </label>
      ) : field.type === "select" ? (
        <select
          value={isDirty ? String(draftValue) : String(field.value ?? "")}
          onChange={(e) => onChange(field.key, e.target.value)}
          className={inputClass}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            type={field.is_secret ? "password" : field.type === "number" ? "number" : "text"}
            value={isDirty ? String(draftValue) : field.is_secret ? "" : String(field.value ?? "")}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={
              isDirty
                ? ""
                : field.is_secret
                  ? field.masked
                    ? `${field.masked} — type to replace`
                    : (field.placeholder ?? "")
                  : (field.placeholder ?? "")
            }
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} flex-1 min-w-[200px] ${field.is_secret ? "font-mono text-[11px]" : ""}`}
          />
          {field.is_secret && field.is_set && !isDirty && (
            <button
              type="button"
              onClick={() => onChange(field.key, "")}
              className="px-3 py-2 rounded-xl border border-[var(--color-line)] text-[11px] font-bold hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] transition-colors"
            >
              Clear
            </button>
          )}
          {isDirty && (
            <button
              type="button"
              onClick={() =>
                onChange(field.key, field.is_secret ? "" : String(field.value ?? ""))
              }
              className="px-3 py-2 rounded-xl border border-[var(--color-line)] text-[11px] font-bold transition-colors"
            >
              Undo
            </button>
          )}
        </div>
      )}

      {field.hint && !error && (
        <p className="text-[10px] text-[var(--color-ink-faint)] mt-1.5 leading-relaxed">
          {field.hint}
        </p>
      )}
      {error && (
        <p className="text-[10px] text-[var(--color-danger)] mt-1.5 leading-relaxed">
          {error}
        </p>
      )}
    </div>
  );
}
