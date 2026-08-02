export type EvidenceLevel = 'design' | 'software' | 'demo';

export interface ProductResult {
    value: string;
    label: string;
    detail: string;
    evidence: EvidenceLevel;
}

export const productResults: ProductResult[] = [
    {
        value: '4',
        label: 'Wearable sensor nodes',
        detail: 'Neck, lower back, left shoulder, and right shoulder orientations.',
        evidence: 'design',
    },
    {
        value: '5 + 5 s',
        label: 'Forecast window',
        detail: 'Five seconds of movement estimate risk during the following five seconds.',
        evidence: 'design',
    },
    {
        value: '0.785',
        label: 'Demo PR-AUC',
        detail: 'Pipeline demonstration using generated trajectories, not real participants.',
        evidence: 'demo',
    },
    {
        value: '3.4 s',
        label: 'Demo median lead time',
        detail: 'Detected demo events only; real-world forecasting remains to be validated.',
        evidence: 'demo',
    },
];

export const evidenceLabels: Record<EvidenceLevel, string> = {
    design: 'System design',
    software: 'Software verification',
    demo: 'Generated-data demo',
};
