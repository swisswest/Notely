import { useCallback, useEffect, useState } from 'react';

import { Button, Field, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { refreshStatus, reportError, showToast, useStore } from '@/lib/store';
import type { AppSettings, ModelInfo, UsageSummary } from '@/types';

const CUSTOM_OPTION = '__custom__';

function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

interface ClaudeSectionProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export function ClaudeSection({ settings, onChange }: ClaudeSectionProps) {
  const apiKeySet = useStore((state) => state.status?.apiKeySet ?? false);
  const apiKeyHint = useStore((state) => state.status?.apiKeyHint ?? null);
  const savedModel = useStore((state) => state.status?.settings.claude.model ?? '');

  const [keyInput, setKeyInput] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [testing, setTesting] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    api.settings
      .usage()
      .then(setUsage)
      .catch(() => undefined);
  }, []);

  const loadModels = useCallback(async (silent: boolean) => {
    setLoadingModels(true);
    try {
      setModels(await api.settings.models());
    } catch (error) {
      if (!silent) reportError(error);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  // Beim Öffnen der Einstellungen einmal still laden, damit die Liste sofort steht.
  useEffect(() => {
    if (apiKeySet) void loadModels(true);
  }, [apiKeySet, loadModels]);

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    try {
      await api.settings.setApiKey(keyInput.trim());
      setKeyInput('');
      await refreshStatus();
      await loadModels(true);
      showToast({ kind: 'success', message: 'API-Key im Windows Credential Manager gespeichert' });
    } catch (error) {
      reportError(error);
    }
  };

  const clearKey = async () => {
    try {
      await api.settings.clearApiKey();
      setModels([]);
      await refreshStatus();
      showToast({ kind: 'info', message: 'API-Key entfernt' });
    } catch (error) {
      reportError(error);
    }
  };

  // Getestet wird immer die aktuelle Auswahl, nicht der gespeicherte Stand -
  // sonst meldet der Test ein anderes Modell als im Dropdown steht.
  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await api.settings.testConnection(settings.claude.model);
      const unsaved = settings.claude.model !== savedModel;
      showToast({
        kind: result.ok ? 'success' : 'error',
        message: unsaved
          ? `${result.message} Noch nicht gespeichert - unten auf Speichern klicken.`
          : result.message,
      });
    } catch (error) {
      reportError(error);
    } finally {
      setTesting(false);
    }
  };

  const setModel = (model: string) =>
    onChange({ ...settings, claude: { ...settings.claude, model } });

  // Das aktuell eingestellte Modell steht immer in der Liste, auch wenn der
  // Account es nicht (mehr) anbietet - sonst wuerde die Auswahl es still ersetzen.
  const options: ModelInfo[] = [...models];
  if (!options.some((model) => model.id === settings.claude.model)) {
    options.unshift({ id: settings.claude.model, displayName: settings.claude.model });
  }

  return (
    <section className="settings__group">
      <h3 className="settings__group-title">Claude</h3>

      <Field
        label="API-Key"
        hint={
          apiKeySet
            ? `Hinterlegt (${apiKeyHint ?? 'maskiert'}). Der Key liegt im Windows Credential Manager und wird nie im Klartext angezeigt.`
            : 'Noch kein Key hinterlegt. Ohne Key funktioniert die App vollständig, nur ohne Analyse.'
        }
      >
        <div className="field__row">
          <TextInput
            type="password"
            placeholder={apiKeySet ? 'Neuen Key eingeben, um zu ersetzen' : 'sk-ant-...'}
            value={keyInput}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setKeyInput(event.currentTarget.value)}
          />
          <Button variant="primary" onClick={() => void saveKey()} disabled={!keyInput.trim()}>
            Speichern
          </Button>
          {apiKeySet ? (
            <Button variant="danger" onClick={() => void clearKey()}>
              Entfernen
            </Button>
          ) : null}
        </div>
      </Field>

      <Field
        label="Modell"
        hint={
          settings.claude.model !== savedModel
            ? `Aktiv ist weiterhin "${savedModel}". Die Auswahl gilt erst nach dem Speichern.`
            : apiKeySet
              ? 'Die Liste kommt direkt von deinem Anthropic-Account. Änderung wirkt ab der nächsten Analyse.'
              : 'Ohne hinterlegten API-Key lässt sich die Modellliste nicht laden. Die ID kann trotzdem manuell gesetzt werden.'
        }
      >
        <div className="field__row">
          {customModel ? (
            <TextInput
              value={settings.claude.model}
              spellCheck={false}
              autoFocus
              placeholder="z. B. claude-sonnet-4-5"
              onChange={(event) => setModel(event.currentTarget.value)}
            />
          ) : (
            <select
              className="select"
              value={settings.claude.model}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === CUSTOM_OPTION) {
                  setCustomModel(true);
                  return;
                }
                setModel(value);
              }}
            >
              {options.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName === model.id
                    ? model.id
                    : `${model.displayName} (${model.id})`}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>Andere Modell-ID eingeben...</option>
            </select>
          )}

          {customModel ? (
            <Button onClick={() => setCustomModel(false)}>Liste</Button>
          ) : (
            <Button onClick={() => void loadModels(false)} disabled={!apiKeySet || loadingModels}>
              {loadingModels ? 'Lädt...' : 'Aktualisieren'}
            </Button>
          )}

          <Button onClick={() => void testConnection()} disabled={!apiKeySet || testing}>
            {testing ? 'Teste...' : 'Verbindung testen'}
          </Button>
        </div>
      </Field>

      {usage ? (
        <Field
          label="Verbrauch"
          hint="Tokens laut API. Was das kostet, hängt vom Modell ab - die Preise stehen in der Anthropic Console."
        >
          <div className="usage-grid">
            <span>Heute</span>
            <span>{usage.today.analyses} Analysen</span>
            <span>{formatTokens(usage.today.inputTokens + usage.today.outputTokens)} Tokens</span>

            <span>Dieser Monat</span>
            <span>{usage.month.analyses} Analysen</span>
            <span>{formatTokens(usage.month.inputTokens + usage.month.outputTokens)} Tokens</span>

            <span>Gesamt</span>
            <span>{usage.total.analyses} Analysen</span>
            <span>{formatTokens(usage.total.inputTokens + usage.total.outputTokens)} Tokens</span>
          </div>
        </Field>
      ) : null}
    </section>
  );
}
