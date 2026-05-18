import { TToolType } from '../kl-types';

export type THandClickDetectorOptions = {
    onTrigger: () => void;
    windowMs?: number; // default 5000
    threshold?: number; // default 6
};

export class HandClickDetector {
    private timestamps: number[] = [];
    private readonly windowMs: number;
    private readonly threshold: number;
    private readonly onTrigger: () => void;

    constructor(opts: THandClickDetectorOptions) {
        this.onTrigger = opts.onTrigger;
        this.windowMs = opts.windowMs ?? 5000;
        this.threshold = opts.threshold ?? 6;
    }

    record(tool: TToolType) {
        if (tool !== 'hand') {
            this.timestamps = [];
            return;
        }
        const now = performance.now();
        this.timestamps.push(now);
        const cutoff = now - this.windowMs;
        this.timestamps = this.timestamps.filter((t) => t >= cutoff);
        if (this.timestamps.length >= this.threshold) {
            this.timestamps = [];
            this.onTrigger();
        }
    }
}
