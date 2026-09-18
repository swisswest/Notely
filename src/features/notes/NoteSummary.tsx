import { type Digest, digest } from '@/utils/markdown';

/**
 * Titelzeile und Inhaltsanriss einer Notiz für die Listen.
 *
 * Die erste sinnvolle Zeile ist der Titel. Vorher stand in der Liste der
 * Rohtext, und eine Notiz, die mit `# Einkauf` beginnt, zeigte auch genau
 * das - samt Raute. Hier wird die Auszeichnung aufgelöst, aus Bildern und
 * Tabellen wird lesbarer Text.
 */

/**
 * Nur der Anfang wird ausgewertet. Die Liste zeigt eine Zeile Titel und eine
 * Zeile Text - dafür ein langes Dokument komplett zu zerlegen wäre reine
 * Verschwendung, und zwar bei jedem Tastendruck in der Suche.
 */
const SOURCE_CHARS = 1200;

/** Ergebnisse je Textstand, damit erneutes Rendern nicht erneut parst. */
const cache = new Map<string, Digest>();
const CACHE_MAX = 400;

export function summarize(content: string): Digest {
  const cached = cache.get(content);
  if (cached) return cached;

  const value = digest(content.slice(0, SOURCE_CHARS));
  // Einfach leeren statt eine Verdrängungsstrategie zu bauen: die Einträge
  // sind billig wiederherzustellen, begrenzt werden muss nur der Speicher.
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(content, value);
  return value;
}

interface NoteSummaryProps {
  content: string;
  /** Ohne Anriss bleibt nur die Titelzeile - für gedrängte Listen. */
  withRest?: boolean;
}

export function NoteSummary({ content, withRest = true }: NoteSummaryProps) {
  const { title, rest } = summarize(content);
  return (
    <>
      <span className="note-item__title">{title}</span>
      {withRest && rest ? <span className="note-item__preview">{rest}</span> : null}
    </>
  );
}
