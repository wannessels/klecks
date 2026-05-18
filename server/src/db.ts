import Database from 'better-sqlite3';

export type TSide = 'klecks' | 'peer';
export type TMessageRow =
    | { id: number; sender: TSide; kind: 'text'; text: string; createdAt: number }
    | { id: number; sender: TSide; kind: 'image'; imageData: Buffer; createdAt: number };

export class MessageStore {
    private readonly db: Database.Database;

    constructor(path: string) {
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL CHECK (sender IN ('klecks','peer')),
                kind TEXT NOT NULL CHECK (kind IN ('text','image')),
                text TEXT,
                image_data BLOB,
                created_at INTEGER NOT NULL,
                CHECK (
                    (kind='text'  AND text IS NOT NULL AND image_data IS NULL) OR
                    (kind='image' AND text IS NULL AND image_data IS NOT NULL)
                )
            );
            CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
        `);
    }

    insertText(sender: TSide, text: string): number {
        const r = this.db
            .prepare('INSERT INTO messages (sender, kind, text, created_at) VALUES (?, ?, ?, ?)')
            .run(sender, 'text', text, Date.now());
        return Number(r.lastInsertRowid);
    }

    insertImage(sender: TSide, imageBytes: Buffer): number {
        const r = this.db
            .prepare('INSERT INTO messages (sender, kind, image_data, created_at) VALUES (?, ?, ?, ?)')
            .run(sender, 'image', imageBytes, Date.now());
        return Number(r.lastInsertRowid);
    }

    lastN(limit = 50): TMessageRow[] {
        const rows = this.db
            .prepare('SELECT id, sender, kind, text, image_data AS imageData, created_at AS createdAt FROM messages ORDER BY created_at DESC LIMIT ?')
            .all(limit) as any[];
        return rows.reverse().map((r) =>
            r.kind === 'text'
                ? { id: r.id, sender: r.sender, kind: 'text', text: r.text, createdAt: r.createdAt }
                : { id: r.id, sender: r.sender, kind: 'image', imageData: r.imageData as Buffer, createdAt: r.createdAt },
        );
    }
}
