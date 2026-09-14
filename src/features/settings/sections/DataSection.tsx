import { useCallback, useEffect, useState } from 'react';

import { Button, Checkbox, Field, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { refreshAll, refreshStatus, reportError, showToast, useStore } from '@/lib/store';
import type { AppSettings, BackupInfo } from '@/types';
import { formatDateTime } from '@/utils/date';

interface DataSectionProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DataSection({ settings, onChange }: DataSectionProps) {
  const [directory, setDirectory] = useState('');
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [shortcut, setShortcut] = useState(settings.quickCapture.shortcut);
  const [importPath, setImportPath] = useState('');
  const [importFolder, setImportFolder] = useState('');
  const folders = useStore((state) => state.folders);

  const importMarkdown = async () => {
    setBusy(true);
    try {
      const summary = await api.backup.importMarkdown(importPath.trim(), importFolder || null);
      showToast({
        kind: 'success',
        message: `${summary.imported} Notiz(en) importiert, ${summary.duplicates} Dublette(n), ${summary.skipped} übersprungen`,
      });
      await refreshAll();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const reload = useCallback(async () => {
    try {
      const [dir, list] = await Promise.all([api.backup.directory(), api.backup.list()]);
      setDirectory(dir);
      setBackups(list);
    } catch (error) {
      reportError(error);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const backupNow = async () => {
    setBusy(true);
    try {
      const info = await api.backup.now();
      showToast({ kind: 'success', message: `Sicherung erstellt: ${info.fileName}` });
      await Promise.all([reload(), refreshStatus()]);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const exportMarkdown = async () => {
    setBusy(true);
    try {
      const info = await api.backup.exportMarkdown();
      showToast({ kind: 'success', message: `Export geschrieben: ${info.fileName}` });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async (fileName: string) => {
    setBusy(true);
    try {
      const summary = await api.backup.import(fileName);
      showToast({
        kind: 'success',
        message: `Importiert: ${summary.notes} Notizen, ${summary.tasks} Tasks, ${summary.skipped} bereits vorhanden`,
      });
      await refreshAll();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const applyShortcut = async (enabled: boolean) => {
    try {
      const applied = await api.quick.setShortcut(shortcut, enabled);
      setShortcut(applied);
      onChange({
        ...settings,
        quickCapture: { ...settings.quickCapture, shortcut: applied, enabled },
      });
      await refreshStatus();
      showToast({
        kind: 'success',
        message: enabled ? `Kürzel aktiv: ${applied}` : 'Schnellerfassung deaktiviert',
      });
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <>
      <section className="settings__group">
        <h3 className="settings__group-title">Schnellerfassung</h3>
        <p className="field__hint" style={{ marginBottom: 10 }}>
          Systemweites Kürzel öffnet ein kleines Eingabefeld über allen Fenstern. Text eintippen,
          Enter, fertig - die Notiz wird gespeichert und auf Wunsch direkt analysiert.
        </p>

        <Field label="Kürzel" hint="Form: Ctrl+Alt+N. Wird das Kürzel bereits belegt, meldet Windows einen Fehler.">
          <div className="field__row">
            <TextInput
              className="input--compact"
              value={shortcut}
              spellCheck={false}
              onChange={(event) => setShortcut(event.currentTarget.value)}
            />
            <Button onClick={() => void applyShortcut(true)}>Übernehmen</Button>
            {settings.quickCapture.enabled ? (
              <Button variant="ghost" onClick={() => void applyShortcut(false)}>
                Deaktivieren
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => void api.quick.open()}>
              Jetzt öffnen
            </Button>
          </div>
        </Field>

        <div className="field">
          <Checkbox
            checked={settings.quickCapture.analyze}
            label="Schnell erfasste Notizen direkt analysieren"
            onChange={(checked) =>
              onChange({
                ...settings,
                quickCapture: { ...settings.quickCapture, analyze: checked },
              })
            }
          />
        </div>
      </section>

      <section className="settings__group">
        <h3 className="settings__group-title">Tagesabschluss</h3>
        <p className="field__hint" style={{ marginBottom: 10 }}>
          Am Abend zeigt Notely, was heute offen geblieben ist - erledigt abhaken oder mit einem
          Klick auf morgen schieben. Erreichbar auch jederzeit über Strg+K.
        </p>

        <div className="field">
          <Checkbox
            checked={settings.review.enabled}
            label="Abends an offene Aufgaben erinnern"
            onChange={(checked) =>
              onChange({ ...settings, review: { ...settings.review, enabled: checked } })
            }
          />
        </div>

        <Field label="Uhrzeit">
          <TextInput
            type="time"
            className="input--compact"
            value={settings.review.time}
            disabled={!settings.review.enabled}
            onChange={(event) =>
              onChange({
                ...settings,
                review: { ...settings.review, time: event.currentTarget.value },
              })
            }
          />
        </Field>
      </section>

      <section className="settings__group">
        <h3 className="settings__group-title">Sicherung</h3>
        <p className="field__hint" style={{ marginBottom: 10 }}>
          Notizen und Tasks liegen nur auf diesem Rechner. Die Sicherung schreibt alles als
          JSON-Datei in einen Ordner deiner Wahl - kopier den ab und zu weg.
        </p>

        <div className="field">
          <Checkbox
            checked={settings.backup.enabled}
            label="Beim Start automatisch sichern (höchstens einmal pro Tag)"
            onChange={(checked) =>
              onChange({ ...settings, backup: { ...settings.backup, enabled: checked } })
            }
          />
        </div>

        <Field label="Ordner" hint={`Leer lassen für den Standard. Aktuell: ${directory || 'unbekannt'}`}>
          <TextInput
            value={settings.backup.directory}
            placeholder="Standard: Dokumente\Notely Backups"
            spellCheck={false}
            onChange={(event) =>
              onChange({
                ...settings,
                backup: { ...settings.backup, directory: event.currentTarget.value },
              })
            }
            onBlur={() => void reload()}
          />
        </Field>

        <Field label="Sicherungen aufbewahren">
          <TextInput
            type="number"
            className="input--compact"
            min={1}
            max={200}
            value={settings.backup.keep}
            onChange={(event) =>
              onChange({
                ...settings,
                backup: { ...settings.backup, keep: Number(event.currentTarget.value) || 14 },
              })
            }
          />
        </Field>

        <div className="field__row" style={{ marginBottom: 12 }}>
          <Button variant="primary" onClick={() => void backupNow()} disabled={busy}>
            Jetzt sichern
          </Button>
          <Button onClick={() => void exportMarkdown()} disabled={busy}>
            Als Markdown exportieren
          </Button>
          <Button variant="ghost" onClick={() => void reload()}>
            Aktualisieren
          </Button>
        </div>

        {settings.backup.lastBackupAt ? (
          <p className="field__hint">Letzte Sicherung: {formatDateTime(settings.backup.lastBackupAt)}</p>
        ) : (
          <p className="field__hint">Noch keine Sicherung erstellt.</p>
        )}

        <div className="divider" />

        <Field
          label="Markdown-Ordner importieren"
          hint="Liest .md, .markdown und .txt aus einem Ordner als Notizen ein - nicht rekursiv. Inhalte, die schon als Notiz existieren, werden übersprungen."
        >
          <div className="field__row">
            <TextInput
              value={importPath}
              placeholder="C:\Users\...\Notizen"
              spellCheck={false}
              onChange={(event) => setImportPath(event.currentTarget.value)}
            />
            <select
              className="select input--compact"
              value={importFolder}
              onChange={(event) => setImportFolder(event.currentTarget.value)}
            >
              <option value="">Ohne Ordner</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <Button onClick={() => void importMarkdown()} disabled={busy || !importPath.trim()}>
              Importieren
            </Button>
          </div>
        </Field>

        {backups.length > 0 ? (
          <>
            <h4 className="section__title">Vorhandene Sicherungen</h4>
            {backups.slice(0, 10).map((info) => (
              <div className="organize-row" key={info.fileName}>
                <span className="field__hint">
                  {formatDateTime(info.createdAt)} · {formatSize(info.sizeBytes)} · {info.fileName}
                </span>
                <Button
                  variant="ghost"
                  disabled={busy}
                  title="Inhalte aus dieser Sicherung ergänzen"
                  onClick={() => void importBackup(info.fileName)}
                >
                  Wiederherstellen
                </Button>
              </div>
            ))}
            <p className="field__hint" style={{ marginTop: 8 }}>
              Wiederherstellen ergänzt fehlende Einträge. Vorhandene Notizen und Tasks werden nie
              überschrieben oder gelöscht.
            </p>
          </>
        ) : null}
      </section>
    </>
  );
}
