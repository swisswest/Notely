import { useEffect, useState } from 'react';

import { Button, Dialog, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { refreshOrganization, reportError, run, useStore } from '@/lib/store';

/** Fallback, falls die Farbliste aus dem Backend nicht kommt. */
const FALLBACK_COLORS = ['slate', 'blue', 'green', 'amber', 'red', 'violet', 'teal', 'pink'];

export function OrganizeDialog({ onClose }: { onClose: () => void }) {
  const folders = useStore((state) => state.folders);
  const labels = useStore((state) => state.labels);

  const [colors, setColors] = useState<string[]>(FALLBACK_COLORS);
  const [folderName, setFolderName] = useState('');
  const [labelName, setLabelName] = useState('');
  const [labelColor, setLabelColor] = useState('slate');

  useEffect(() => {
    api.labels
      .colors()
      .then((available) => {
        if (available.length > 0) setColors(available);
      })
      .catch(() => undefined);
  }, []);

  const addFolder = async () => {
    if (!folderName.trim()) return;
    const created = await run(() => api.folders.create(folderName.trim()));
    if (created) setFolderName('');
  };

  const addLabel = async () => {
    if (!labelName.trim()) return;
    const created = await run(() => api.labels.create(labelName.trim(), labelColor));
    if (created) setLabelName('');
  };

  const renameFolder = async (id: string, name: string) => {
    try {
      await api.folders.rename(id, name);
      await refreshOrganization();
    } catch (error) {
      reportError(error);
      await refreshOrganization();
    }
  };

  const changeLabel = async (id: string, name: string, color: string) => {
    try {
      await api.labels.update(id, name, color);
      await refreshOrganization();
    } catch (error) {
      reportError(error);
      await refreshOrganization();
    }
  };

  return (
    <Dialog
      title="Ordner und Labels"
      subtitle="Ordner löschen entfernt keine Notizen - sie landen wieder unter „Ohne Ordner“."
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Fertig
        </Button>
      }
    >
      <h3 className="settings__group-title">Ordner</h3>
      {folders.map((folder) => (
        <div className="organize-row" key={folder.id}>
          <TextInput
            defaultValue={folder.name}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value && value !== folder.name) void renameFolder(folder.id, value);
            }}
          />
          <Button
            variant="danger"
            title="Ordner löschen"
            onClick={() => void run(() => api.folders.remove(folder.id))}
          >
            Löschen
          </Button>
        </div>
      ))}
      <div className="organize-row">
        <TextInput
          placeholder="Neuer Ordner"
          value={folderName}
          onChange={(event) => setFolderName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void addFolder();
          }}
        />
        <Button onClick={() => void addFolder()} disabled={!folderName.trim()}>
          Anlegen
        </Button>
      </div>

      <div className="divider" />

      <h3 className="settings__group-title">Labels</h3>
      {labels.map((label) => (
        <div className="organize-row organize-row--label" key={label.id}>
          <TextInput
            defaultValue={label.name}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value && value !== label.name) void changeLabel(label.id, value, label.color);
            }}
          />
          <select
            className="select"
            value={label.color}
            onChange={(event) => void changeLabel(label.id, label.name, event.currentTarget.value)}
          >
            {colors.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
          <Button
            variant="danger"
            title="Label löschen"
            onClick={() => void run(() => api.labels.remove(label.id))}
          >
            Löschen
          </Button>
        </div>
      ))}
      <div className="organize-row organize-row--label">
        <TextInput
          placeholder="Neues Label"
          value={labelName}
          onChange={(event) => setLabelName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void addLabel();
          }}
        />
        <select
          className="select"
          value={labelColor}
          onChange={(event) => setLabelColor(event.currentTarget.value)}
        >
          {colors.map((color) => (
            <option key={color} value={color}>
              {color}
            </option>
          ))}
        </select>
        <Button onClick={() => void addLabel()} disabled={!labelName.trim()}>
          Anlegen
        </Button>
      </div>
    </Dialog>
  );
}
