import { useState } from 'react';

import { Button, Checkbox, Confidence, Dialog, TextInput } from '@/components/ui';
import { api } from '@/lib/ipc';
import { run } from '@/lib/store';
import type { AnalysisResult, TaskSuggestion } from '@/types';

interface Row extends TaskSuggestion {
  selected: boolean;
}

interface SuggestionDialogProps {
  result: AnalysisResult;
  onClose: () => void;
}

export function SuggestionDialog({ result, onClose }: SuggestionDialogProps) {
  const [rows, setRows] = useState<Row[]>(
    result.suggestions.map((suggestion) => ({ ...suggestion, selected: !suggestion.inPast })),
  );

  const update = (index: number, patch: Partial<Row>) => {
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  };

  const selectedCount = rows.filter((row) => row.selected).length;

  const submit = async () => {
    const chosen: TaskSuggestion[] = rows
      .filter((row) => row.selected && row.title.trim())
      .map((row) => ({
        title: row.title,
        description: row.description,
        dueDate: row.dueDate,
        dueTime: row.dueTime,
        confidence: row.confidence,
        daypartKey: row.daypartKey,
        inPast: row.inPast,
      }));

    if (chosen.length === 0) {
      onClose();
      return;
    }

    const created = await run(() => api.ai.createFromSuggestions(result.noteId, chosen), {
      success: `${chosen.length} Task(s) erstellt`,
    });
    if (created) onClose();
  };

  return (
    <Dialog
      title={`Claude hat ${result.suggestions.length} Aufgabe(n) erkannt`}
      subtitle="Vorschläge prüfen, bei Bedarf anpassen und übernehmen."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Verwerfen
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={selectedCount === 0}>
            {selectedCount} Task(s) erstellen
          </Button>
        </>
      }
    >
      {rows.map((row, index) => (
        <div className="suggestion" key={`${row.title}-${index}`}>
          <Checkbox
            checked={row.selected}
            ariaLabel={`${row.title} übernehmen`}
            onChange={(checked) => update(index, { selected: checked })}
          />
          <div>
            <TextInput
              value={row.title}
              onChange={(event) => update(index, { title: event.currentTarget.value })}
            />
            <div className="suggestion__fields">
              <TextInput
                type="date"
                className="input--compact"
                value={row.dueDate ?? ''}
                onChange={(event) => update(index, { dueDate: event.currentTarget.value || null })}
              />
              <TextInput
                type="time"
                className="input--compact"
                value={row.dueTime ?? ''}
                onChange={(event) => update(index, { dueTime: event.currentTarget.value || null })}
              />
            </div>
            <div className="suggestion__meta">
              <Confidence value={row.confidence} />
              {row.daypartKey ? <span className="tag">{row.daypartKey}</span> : null}
              {row.inPast ? <span className="tag tag--warning">liegt in der Vergangenheit</span> : null}
              {row.description ? <span>{row.description}</span> : null}
            </div>
          </div>
        </div>
      ))}

      {result.rejected.length > 0 ? (
        <p className="field__hint" style={{ marginTop: 12 }}>
          Verworfen: {result.rejected.join(' · ')}
        </p>
      ) : null}
    </Dialog>
  );
}
