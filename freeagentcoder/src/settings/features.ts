import type * as vscode from 'vscode';
import type { FeatureId, FeatureView } from '../shared/protocol';

export type Features = Record<FeatureId, boolean>;

const STORAGE_KEY = 'freeagentcoder.features.v1';

export const FEATURE_INFO: { id: FeatureId; label: string; description: string }[] = [
    {
        id: 'seniorMode',
        label: 'Senior mode for builds',
        description: 'Stack playbooks, required quality checks (analyze, test, build) and a quality report when you ask it to build or ship something.',
    },
    {
        id: 'readAttachments',
        label: 'Read attachments with a vision model',
        description: 'A dedicated model reads screenshots and scanned PDFs, and summarizes very long documents, before the task starts. Uses one extra request per task with attachments.',
    },
    {
        id: 'learning',
        label: 'Learn from corrections',
        description: 'After you correct its work, it saves a short lesson and follows it in later tasks. Review or delete lessons in Memory.',
    },
    {
        id: 'codeSearch',
        label: 'Attach relevant files',
        description: 'Searches your project locally and gives complex tasks the most relevant files up front. Uses no API quota.',
    },
    {
        id: 'autoRecovery',
        label: 'Automatic recovery',
        description: 'When every model is rate-limited or the connection drops, it waits and resumes the task instead of stopping.',
    },
];

export function isFeatureId(value: unknown): value is FeatureId {
    return FEATURE_INFO.some((f) => f.id === value);
}

export function loadFeatures(state: vscode.Memento): Features {
    const saved = state.get<Partial<Features>>(STORAGE_KEY, {});
    return Object.fromEntries(FEATURE_INFO.map((f) => [f.id, typeof saved[f.id] === 'boolean' ? saved[f.id] : true])) as Features;
}

export function saveFeatures(state: vscode.Memento, features: Features): Thenable<void> {
    return state.update(STORAGE_KEY, features);
}

export function featureViews(features: Features): FeatureView[] {
    return FEATURE_INFO.map((f) => ({ ...f, on: features[f.id] }));
}
