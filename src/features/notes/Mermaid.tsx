import { useEffect, useRef, useState } from 'react';

/**
 * Zeichnet ein Mermaid-Diagramm.
 *
 * Zwei Entscheidungen, die hier wichtiger sind als sie aussehen:
 *
 * 1. Die Bibliothek wird erst beim ersten Diagramm nachgeladen. Wer nie eines
 *    schreibt, lädt auch nie das knappe Megabyte dafür.
 * 2. Geht irgendetwas schief - Laden, Syntax, Zeichnen -, erscheint der
 *    Quelltext des Diagramms samt Meldung. Ein Tippfehler in einem Diagramm
 *    darf niemals dazu führen, dass die Notiz unlesbar wird.
 *
 * Zum Laden gibt es eine Vorgeschichte: Mermaid zieht `dayjs` statisch herein,
 * und dayjs weist `valueOf` auf seinem Prototyp per Zuweisung zu. Solange
 * `freezePrototype` die eingebauten Prototypen einfror, scheiterte das im
 * Strict-Modus - und zwar beim Import, also bei jedem Diagramm. Deshalb steht
 * die Einstellung in `tauri.conf.json` auf `false`; die Begründung dazu in
 * SECURITY.md.
 */

type Renderer = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

let loading: Promise<Renderer> | null = null;

/** Lädt und konfiguriert Mermaid genau einmal je Programmlauf. */
function renderer(): Promise<Renderer> {
  if (!loading) {
    loading = import('mermaid').then((module) => {
      const instance = (module.default ?? module) as unknown as Renderer;
      instance.initialize({
        startOnLoad: false,
        // Strict verbietet HTML im Diagrammtext. Der Text kommt zwar aus der
        // eigenen Notiz, aber ein Notizinhalt kann auch aus einem Import oder
        // einer Sicherung stammen - also gilt er als fremd.
        securityLevel: 'strict',
        theme: 'neutral',
        fontFamily: 'inherit',
      });
      return instance;
    });
  }
  return loading;
}

let counter = 0;

export function Mermaid({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    counter += 1;
    const id = `notely-diagram-${counter}`;

    setError(null);

    renderer()
      .then((mermaid) => mermaid.render(id, source))
      .then(({ svg }) => {
        if (cancelled || !host.current) return;
        // Das SVG stammt aus Mermaid im Strict-Modus, nicht aus dem Notiztext.
        host.current.innerHTML = svg;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Diagramm konnte nicht gezeichnet werden');
      });

    return () => {
      cancelled = true;
      // Mermaid hängt bei einem Fehler eine Fehlergrafik in den Body.
      document.getElementById(`d${id}`)?.remove();
    };
  }, [source]);

  if (error) {
    return (
      <div className="md__diagram md__diagram--failed">
        <p className="md__diagram-error">Diagramm nicht darstellbar: {error}</p>
        <pre className="md__code">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return <div className="md__diagram" ref={host} />;
}
