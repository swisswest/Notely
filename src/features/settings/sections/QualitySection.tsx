import { useCallback, useEffect, useState } from 'react';

import { Button, Checkbox, EmptyState } from '@/components/ui';
import { api } from '@/lib/ipc';
import { reportError, showToast } from '@/lib/store';
import type { AppSettings, FeedbackCounts, FeedbackEntry, FeedbackSummary } from '@/types';

interface QualitySectionProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

function hitRate(counts: FeedbackCounts): string {
  const total = counts.accepted + counts.edited + counts.rejected;
  if (total === 0) return '–';
  return `${Math.round((counts.accepted / total) * 100)} %`;
}

function when(entry: FeedbackEntry): string {
  const date = new Date(entry.createdAt);
  return Number.isNaN(date.getTime())
    ? entry.createdAt
    : date.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Zeigt Datum und Uhrzeit eines Vorschlags kompakt an. */
function due(date: string | null, time: string | null): string {
  if (!date) return 'ohne Termin';
  return time ? `${date} ${time}` : date;
}

function Miss({ entry }: { entry: FeedbackEntry }) {
  const changed = entry.verdict === 'edited' && entry.corrected;

  return (
    <div className="miss">
      <div className="miss__head">
        <span className={`tag ${entry.verdict === 'rejected' ? 'tag--warning' : ''}`}>
          {entry.verdict === 'rejected' ? 'verworfen' : 'korrigiert'}
        </span>
        <span className="field__hint">{when(entry)}</span>
      </div>

      {entry.noteExcerpt ? <p className="miss__excerpt">{entry.noteExcerpt}</p> : null}

      <p className="miss__line">
        Claude: <strong>{entry.suggested.title}</strong> ·{' '}
        {due(entry.suggested.dueDate, entry.suggested.dueTime)}
        {entry.suggested.daypartKey ? ` · ${entry.suggested.daypartKey}` : ''}
      </p>

      {changed && entry.corrected ? (
        <p className="miss__line">
          Übernommen: <strong>{entry.corrected.title}</strong> ·{' '}
          {due(entry.corrected.dueDate, entry.corrected.dueTime)}
        </p>
      ) : null}
    </div>
  );
}

export function QualitySection({ settings, onChange }: QualitySectionProps) {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);

  const load = useCallback(() => {
    api.ai
      .feedback()
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  useEffect(load, [load]);

  const clear = async () => {
    try {
      await api.ai.clearFeedback();
      showToast({ kind: 'success', message: 'Auswertung geleert' });
      load();
    } catch (error) {
      reportError(error);
    }
  };

  const total = summary?.total;
  const hasData = Boolean(total && total.accepted + total.edited + total.rejected > 0);

  return (
    <section className="settings__group">
      <h3 className="settings__group-title">Analysequalität</h3>

      <div className="field">
        <Checkbox
          checked={settings.ai.collectFeedback}
          label="Festhalten, welche Vorschläge übernommen, korrigiert oder verworfen werden"
          onChange={(checked) =>
            onChange({ ...settings, ai: { ...settings.ai, collectFeedback: checked } })
          }
        />
        <span className="field__hint">
          Bleibt vollständig auf diesem Gerät. Ohne diese Daten lässt sich nur raten, wie gut die
          Erkennung wirklich arbeitet.
        </span>
      </div>

      {hasData && summary ? (
        <>
          <div className="quality">
            <div className="quality__cell">
              <span className="quality__value">{hitRate(summary.recent)}</span>
              <span className="field__hint">unverändert übernommen (30 Tage)</span>
            </div>
            <div className="quality__cell">
              <span className="quality__value">{summary.recent.edited}</span>
              <span className="field__hint">korrigiert</span>
            </div>
            <div className="quality__cell">
              <span className="quality__value">{summary.recent.rejected}</span>
              <span className="field__hint">verworfen</span>
            </div>
            <div className="quality__cell">
              <span className="quality__value">{hitRate(summary.total)}</span>
              <span className="field__hint">gesamt</span>
            </div>
          </div>

          {summary.misses.length > 0 ? (
            <>
              <p className="field__hint" style={{ marginTop: 12 }}>
                Die jüngsten Fehlgriffe. Wiederholt sich ein Muster, gehört es in die Tageszeiten
                oder in eine deutlichere Formulierung der Notiz.
              </p>
              <div className="miss-list">
                {summary.misses.map((entry) => (
                  <Miss key={entry.id} entry={entry} />
                ))}
              </div>
            </>
          ) : (
            <p className="field__hint" style={{ marginTop: 12 }}>
              Bisher wurde kein Vorschlag korrigiert oder verworfen.
            </p>
          )}

          <div className="field__row" style={{ marginTop: 12 }}>
            <Button variant="danger" onClick={() => void clear()}>
              Auswertung löschen
            </Button>
          </div>
        </>
      ) : (
        <EmptyState>
          Noch keine Daten. Sobald du Vorschläge bestätigst oder verwirfst, entsteht hier eine
          Auswertung.
        </EmptyState>
      )}
    </section>
  );
}
