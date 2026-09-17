import { Fragment, type ReactNode } from 'react';

import { AttachmentImage } from '@/features/notes/AttachmentImage';
import { Mermaid } from '@/features/notes/Mermaid';
import type { Block, Inline } from '@/utils/markdown';
import { attachmentId, parseMarkdown } from '@/utils/markdown';

interface MarkdownProps {
  source: string;
  /**
   * Was beim Klick auf einen Link passieren soll. In der App wird die Adresse
   * kopiert - die Webview wegzunavigieren würde die Notiz aus dem Fenster
   * werfen, und einen Browser öffnen darf Notely bewusst nicht.
   */
  onLink?: (href: string) => void;
  /** Diagramme zeichnen. Für Druck und Export abschaltbar. */
  diagrams?: boolean;
}

/**
 * Zeigt Markdown als React-Elemente an.
 *
 * Es wird nirgends HTML zusammengesetzt und eingehängt. Was hier entsteht,
 * sind ausschliesslich React-Knoten - Text bleibt Text, auch wenn er wie ein
 * Tag aussieht.
 */
export function Markdown({ source, onLink, diagrams = true }: MarkdownProps) {
  const blocks = parseMarkdown(source);

  if (blocks.length === 0) {
    return <p className="md__empty">Noch nichts geschrieben.</p>;
  }

  return (
    <div className="md">
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block, onLink, diagrams)}</Fragment>
      ))}
    </div>
  );
}

function renderBlock(block: Block, onLink?: (href: string) => void, diagrams = true): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1';
      return <Tag className="md__heading">{renderInline(block.content, onLink)}</Tag>;
    }

    case 'paragraph':
      return <p>{renderInline(block.content, onLink)}</p>;

    case 'quote':
      return <blockquote>{renderInline(block.content, onLink)}</blockquote>;

    case 'rule':
      return <hr />;

    case 'code':
      // Ein Mermaid-Block ist kein Code zum Lesen, sondern ein Bild zum
      // Anschauen - solange das Zeichnen gelingt.
      if (diagrams && block.language.toLowerCase() === 'mermaid') {
        return <Mermaid source={block.value} />;
      }
      return (
        <pre className="md__code">
          <code>{block.value}</code>
        </pre>
      );

    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index} data-task={item.checked !== null}>
          {item.checked !== null ? (
            <input
              type="checkbox"
              checked={item.checked}
              readOnly
              tabIndex={-1}
              aria-label={item.checked ? 'erledigt' : 'offen'}
            />
          ) : null}
          <span>{renderInline(item.content, onLink)}</span>
        </li>
      ));
      return block.ordered ? (
        <ol className="md__list">{items}</ol>
      ) : (
        <ul className="md__list">{items}</ul>
      );
    }

    case 'table':
      return (
        <div className="md__table-wrap">
          <table className="md__table">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index}>{renderInline(cell, onLink)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell, onLink)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function renderInline(nodes: Inline[], onLink?: (href: string) => void): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={index}>{node.value}</Fragment>;
      case 'strong':
        return <strong key={index}>{renderInline(node.children, onLink)}</strong>;
      case 'em':
        return <em key={index}>{renderInline(node.children, onLink)}</em>;
      case 'strike':
        return <s key={index}>{renderInline(node.children, onLink)}</s>;
      case 'code':
        return (
          <code key={index} className="md__inline-code">
            {node.value}
          </code>
        );
      case 'image': {
        const id = attachmentId(node.src);
        // Anhang aus der Datenbank oder eingebettete Daten - anderes lässt
        // der Parser gar nicht erst als Bild durch.
        return id ? (
          <AttachmentImage key={index} id={id} alt={node.alt} />
        ) : (
          <img key={index} className="md__image" src={node.src} alt={node.alt} loading="lazy" />
        );
      }
      case 'link':
        return (
          <a
            key={index}
            className="md__link"
            href={node.href}
            title={`${node.href} – klicken kopiert die Adresse`}
            onClick={(event) => {
              // Ohne das würde die Webview die Notiz verlassen.
              event.preventDefault();
              onLink?.(node.href);
            }}
          >
            {renderInline(node.children, onLink)}
          </a>
        );
    }
  });
}
