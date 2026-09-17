import { useEffect, useState } from 'react';

import { api, describeError } from '@/lib/ipc';

/**
 * Zeigt ein Bild an, das als Anhang in der Datenbank liegt.
 *
 * Die Daten kommen einmal über die Brücke und werden dann als Blob-Adresse
 * eingehängt. Eine Daten-Adresse täte es auch, hielte aber das ganze Bild
 * doppelt im Speicher - einmal als Zeichenkette, einmal dekodiert.
 *
 * Der Zwischenspeicher gilt für den Programmlauf: dasselbe Bild in mehreren
 * Notizen wird einmal geladen, und ein Wechsel zwischen Schreiben und
 * Vorschau holt es nicht jedes Mal neu.
 */

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function load(id: string): Promise<string> {
    const ready = cache.get(id);
    if (ready) return Promise.resolve(ready);

    const running = pending.get(id);
    if (running) return running;

    const request = api.attachments
        .get(id)
        .then(({ mime, data }) => {
            // Base64 in Bytes, damit daraus ein Blob werden kann.
            const binary = atob(data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

            const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
            cache.set(id, url);
            pending.delete(id);
            return url;
        })
        .catch((error) => {
            pending.delete(id);
            throw error;
        });

    pending.set(id, request);
    return request;
}

interface AttachmentImageProps {
    id: string;
    alt: string;
}

export function AttachmentImage({ id, alt }: AttachmentImageProps) {
    const [url, setUrl] = useState<string | null>(() => cache.get(id) ?? null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (cache.has(id)) {
            setUrl(cache.get(id) ?? null);
            return;
        }

        let cancelled = false;
        setError(null);
        load(id)
            .then((value) => {
                if (!cancelled) setUrl(value);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(describeError(err));
            });

        return () => {
            cancelled = true;
        };
    }, [id]);

    // Ein fehlendes Bild darf die Notiz nicht zerreissen - es gibt Platzhalter,
    // keine leere Stelle. Das passiert etwa, wenn eine Sicherung ohne Bilder
    // eingespielt wurde.
    if (error) {
        return (
            <span className="md__image-missing" title={error}>
                Bild nicht gefunden{alt ? `: ${alt}` : ''}
            </span>
        );
    }

    if (!url) {
        return <span className="md__image-loading">{alt || 'Bild'} wird geladen …</span>;
    }

    return <img className="md__image" src={url} alt={alt} title={alt || undefined} loading="lazy" />;
}
