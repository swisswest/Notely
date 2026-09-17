import { useEffect, useState } from 'react';

import { Markdown } from '@/components/Markdown';
import { Button, Dialog } from '@/components/ui';
import { api } from '@/lib/ipc';
import { reportError, showToast } from '@/lib/store';
import type { Note } from '@/types';
import {
  type ExportFormat,
  type ImageMap,
  buildExport,
  fileNameFor,
  notesToHtml,
  notesToMarkdown,
  referencedImages,
} from '@/utils/export';

interface ExportDialogProps {
  notes: Note[];
  onClose: () => void;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'md', label: 'Markdown', hint: '.md – behält die Auszeichnung' },
  { id: 'txt', label: 'Text', hint: '.txt – ohne Auszeichnung' },
  { id: 'html', label: 'HTML', hint: '.html – eine Datei, öffnet überall' },
];

/**
 * Export einer oder mehrerer Notizen.
 *
 * Der Dialog zeigt, was herauskommt. Das ist nicht nur Zierde: für den
 * PDF-Weg wird genau dieser Bereich gedruckt, und weil er sichtbar ist, sind
 * die Diagramme fertig gezeichnet, bevor jemand auf Drucken klickt.
 */
export function ExportDialog({ notes, onClose }: ExportDialogProps) {
  const [busy, setBusy] = useState(false);
  /**
   * Bilder als Daten-Adresse. Ohne sie wäre eine exportierte Datei voller
   * Verweise auf eine Datenbank, die der Empfänger nicht hat.
   */
  const [images, setImages] = useState<ImageMap>(new Map());
  const [loadingImages, setLoadingImages] = useState(false);

  const many = notes.length > 1;

  useEffect(() => {
    const ids = referencedImages(notes);
    if (ids.length === 0) return;

    let cancelled = false;
    setLoadingImages(true);

    Promise.all(
      ids.map(async (id) => {
        const { mime, data } = await api.attachments.get(id);
        return [id, `data:${mime};base64,${data}`] as const;
      }),
    )
      .then((pairs) => {
        if (!cancelled) setImages(new Map(pairs));
      })
      .catch(reportError)
      .finally(() => {
        if (!cancelled) setLoadingImages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [notes]);

  const save = async (format: ExportFormat) => {
    setBusy(true);
    try {
      const path = await api.system.saveExport(
        fileNameFor(notes, format),
        buildExport(notes, format, images),
      );
      // Abgebrochen ist kein Fehler - dann passiert einfach nichts.
      if (path) {
        showToast({ kind: 'success', message: `Gespeichert: ${path.split('\\').pop() ?? path}` });
        onClose();
      }
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const copyPlain = async () => {
    try {
      await navigator.clipboard.writeText(notesToMarkdown(notes, images));
      showToast({ kind: 'success', message: 'Als Markdown kopiert' });
    } catch (error) {
      reportError(error);
    }
  };

  /**
   * Kopiert formatiert, damit es in Mail oder Word mit Überschriften und
   * Listen ankommt. Kann die Umgebung kein HTML in der Zwischenablage, wird
   * still auf Text zurückgefallen - kopiert wird auf jeden Fall etwas.
   */
  const copyRich = async () => {
    const html = notesToHtml(notes, images);
    const plain = buildExport(notes, 'txt');
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      showToast({ kind: 'success', message: 'Formatiert kopiert' });
    } catch (error) {
      reportError(error);
    }
  };

  const print = () => {
    // Die Druckregeln blenden alles ausser .print-area aus.
    window.print();
  };

  return (
    <Dialog
      title={many ? `${notes.length} Notizen exportieren` : 'Notiz exportieren'}
      subtitle="Die Vorschau zeigt, was gespeichert oder gedruckt wird."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Schliessen
          </Button>
          <Button onClick={() => void copyPlain()} disabled={busy}>
            Markdown kopieren
          </Button>
          <Button onClick={() => void copyRich()} disabled={busy}>
            Formatiert kopieren
          </Button>
          <Button variant="primary" onClick={print} disabled={busy}>
            Als PDF drucken
          </Button>
        </>
      }
    >
      <div className="field__row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {FORMATS.map((format) => (
          <Button
            key={format.id}
            title={format.hint}
            disabled={busy || loadingImages}
            onClick={() => void save(format.id)}
          >
            Als {format.label} speichern
          </Button>
        ))}
      </div>

      <p className="field__hint" style={{ marginBottom: 10 }}>
        Speichern fragt nach dem Zielordner. Für PDF öffnet sich der
        Windows-Druckdialog – dort „Microsoft Print to PDF" wählen. Bilder
        werden in die Datei eingebettet, damit sie für sich steht.
        {loadingImages ? ' Bilder werden vorbereitet …' : ''}
      </p>

      <div className="export__preview print-area">
        {notes.map((note, index) => (
          <div key={note.id}>
            {index > 0 ? <hr /> : null}
            <Markdown source={note.content} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
