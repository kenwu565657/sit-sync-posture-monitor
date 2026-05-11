export function calculateRULA(cvaAngle: number): { score: number, status: string } {
    if (cvaAngle >= 50) return { score: 1, status: 'good' };
    if (cvaAngle >= 40) return { score: 3, status: 'warning' };
    return { score: 5, status: 'critical' };
}