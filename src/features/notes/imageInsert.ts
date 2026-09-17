import { api } from '@/lib/ipc';
import { imageRef } from '@/utils/markdown';

/**
 * Bilder in eine Notiz einfügen - die Logik dahinter, ohne React.
 *
 * Der Weg ist immer derselbe, egal ob eingefügt, hereingezogen oder
 * ausgewählt: Datei prüfen, ablegen, Referenz an die Cursorposition schreiben.
 */

/** Was der Webview zuverlässig darstellen kann und das Backend annimmt. */
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];

export function isSupportedImage(file: File | null): file is File {
  return Boolean(file) && ACCEPTED_TYPES.includes((file as File).type.toLowerCase());
}

/**
 * Liest eine Datei als Base64, ohne den Vorspann der Daten-Adresse.
 *
 * `readAsDataURL` statt `readAsArrayBuffer`: der Browser kodiert selbst, und
 * das ist für ein paar Megabyte deutlich schneller, als es in JavaScript von
 * Hand zu tun.
 */
export function toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Die Datei liess sich nicht lesen'));
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const comma = result.indexOf(',');
            if (comma === -1) {
                reject(new Error('Unerwartetes Format beim Lesen der Datei'));
                return;
            }
            resolve(result.slice(comma + 1));
        };
        reader.readAsDataURL(file);
    });
}

/** Ein sprechender Name, auch wenn die Zwischenablage keinen mitliefert. */
export function nameFor(file: File): string {
    const raw = file.name?.trim();
    if (raw && raw !== 'image.png') return raw;

    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `Screenshot ${pad(now.getDate())}.${pad(now.getMonth() + 1)}. ${pad(
        now.getHours(),
    )}:${pad(now.getMinutes())}`;
}

export interface Inserted {
    /** Text mit der eingefügten Referenz. */
    text: string;
    /** Wo der Cursor danach steht. */
    caret: number;
    /** Kennung des abgelegten Bildes - für das Nachtragen beim Speichern. */
    id: string;
}

/**
 * Legt das Bild ab und baut den neuen Notiztext.
 *
 * `noteId` darf `null` sein. Bei einer noch nie gespeicherten Notiz gibt es
 * noch keine ID; das Bild entsteht dann ohne Zuordnung und wird beim ersten
 * Speichern nachgetragen.
 */
export async function insertImage(
    file: File,
    noteId: string | null,
    text: string,
    caret: number,
): Promise<Inserted> {
    const name = nameFor(file);
    const saved = await api.attachments.add(noteId, name, file.type.toLowerCase(), await toBase64(file));

    const before = text.slice(0, caret);
    const after = text.slice(caret);

    // Ein Bild steht auf einer eigenen Zeile. Mitten im Satz wäre es in der
    // Vorschau kaum lesbar und im Export erst recht nicht.
    const lead = before === '' || before.endsWith('\n') ? '' : '\n';
    const tail = after.startsWith('\n') || after === '' ? '' : '\n';
    const snippet = `${lead}![${saved.name}](${imageRef(saved.id)})\n${tail}`;

    return {
        text: before + snippet + after,
        caret: caret + snippet.length,
        id: saved.id,
    };
}

/** Holt die erste brauchbare Bilddatei aus einer Zwischenablage oder einem Ablegen. */
export function firstImage(data: DataTransfer | null): File | null {
    if (!data) return null;

    for (const file of Array.from(data.files)) {
        if (isSupportedImage(file)) return file;
    }

    // Beim Einfügen aus der Zwischenablage steckt das Bild oft nicht in
    // `files`, sondern nur in `items`.
    for (const item of Array.from(data.items)) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (isSupportedImage(file)) return file;
    }

    return null;
}
