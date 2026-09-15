import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

/** Everything about a key except the secret, which lives only in SecretStorage. */
export interface StoredKey {
    id: string;
    provider: string;
    label: string;
    last4: string;
    createdAt: number;
    enabled: boolean;
    verifiedAt?: number;
    invalidReason?: string;
}

const META_KEY = 'freeagentcoder.keys.v2';
const LEGACY_PREFIX = 'freeagentcoder.keys.';

function secretName(id: string): string {
    return `freeagentcoder.key.${id}`;
}

export class KeyStore implements vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly context: vscode.ExtensionContext) {}

    list(): StoredKey[] {
        return this.context.globalState.get<StoredKey[]>(META_KEY, []);
    }

    get(id: string): StoredKey | undefined {
        return this.list().find((key) => key.id === id);
    }

    async secret(id: string): Promise<string | undefined> {
        return this.context.secrets.get(secretName(id));
    }

    add(provider: string, label: string, secret: string, verifiedAt?: number): Promise<StoredKey> {
        return this.serial(async () => {
            const value = secret.trim();
            const existing = this.list();
            for (const key of existing.filter((k) => k.provider === provider)) {
                if ((await this.secret(key.id)) === value) {
                    throw new Error(`This key is already saved as "${key.label}".`);
                }
            }
            const name = label.trim() || nextLabel(existing, provider);
            assertUniqueLabel(existing, provider, name);
            const key: StoredKey = {
                id: randomBytes(8).toString('hex'),
                provider,
                label: name,
                last4: value.slice(-4),
                createdAt: Date.now(),
                enabled: true,
                verifiedAt,
            };
            await this.context.secrets.store(secretName(key.id), value);
            await this.write([...existing, key]);
            return key;
        });
    }

    update(id: string, patch: Partial<Pick<StoredKey, 'label' | 'enabled' | 'verifiedAt' | 'invalidReason'>>): Promise<void> {
        return this.serial(async () => {
            const keys = this.list();
            const index = keys.findIndex((k) => k.id === id);
            if (index < 0) {
                return;
            }
            const current = keys[index];
            if (patch.label !== undefined) {
                patch.label = patch.label.trim();
                if (!patch.label) {
                    throw new Error('A key needs a name.');
                }
                assertUniqueLabel(keys.filter((k) => k.id !== id), current.provider, patch.label);
            }
            keys[index] = { ...current, ...patch };
            await this.write(keys);
        });
    }

    remove(id: string): Promise<void> {
        return this.serial(async () => {
            await this.context.secrets.delete(secretName(id));
            await this.write(this.list().filter((k) => k.id !== id));
        });
    }

    /** Earlier versions stored unlabeled keys as one JSON array per provider. */
    migrateLegacy(providers: string[]): Promise<void> {
        return this.serial(async () => {
            let keys = this.list();
            let changed = false;
            for (const provider of providers) {
                const name = `${LEGACY_PREFIX}${provider}`;
                const raw = await this.context.secrets.get(name);
                if (!raw) {
                    continue;
                }
                let values: unknown = [];
                try {
                    values = JSON.parse(raw);
                } catch {
                    values = [];
                }
                for (const value of Array.isArray(values) ? values : []) {
                    const secret = typeof value === 'string' ? value.trim() : '';
                    if (!secret) {
                        continue;
                    }
                    let duplicate = false;
                    for (const key of keys.filter((k) => k.provider === provider)) {
                        if ((await this.secret(key.id)) === secret) {
                            duplicate = true;
                        }
                    }
                    if (duplicate) {
                        continue;
                    }
                    const key: StoredKey = {
                        id: randomBytes(8).toString('hex'),
                        provider,
                        label: nextLabel(keys, provider),
                        last4: secret.slice(-4),
                        createdAt: Date.now(),
                        enabled: true,
                    };
                    await this.context.secrets.store(secretName(key.id), secret);
                    keys = [...keys, key];
                    changed = true;
                }
                await this.context.secrets.delete(name);
            }
            if (changed) {
                await this.write(keys);
            }
        });
    }

    dispose(): void {
        this.changed.dispose();
    }

    private async write(keys: StoredKey[]): Promise<void> {
        await this.context.globalState.update(META_KEY, keys);
        this.changed.fire();
    }

    private serial<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(task, task);
        this.queue = run.catch(() => undefined);
        return run;
    }
}

function nextLabel(keys: StoredKey[], provider: string): string {
    const taken = new Set(keys.filter((k) => k.provider === provider).map((k) => k.label.toLowerCase()));
    let n = taken.size + 1;
    while (taken.has(`key ${n}`)) {
        n++;
    }
    return `Key ${n}`;
}

function assertUniqueLabel(keys: StoredKey[], provider: string, label: string): void {
    if (keys.some((k) => k.provider === provider && k.label.toLowerCase() === label.toLowerCase())) {
        throw new Error(`You already have a key named "${label}" for this provider.`);
    }
}
