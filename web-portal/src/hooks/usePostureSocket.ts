import { useState, useEffect } from 'react';

// Define the shape of our incoming data (Matching the Backend)
export interface Quaternion { w: number; x: number; y: number; z: number; }
export interface PostureData {
    timestamp: number;
    metrics: {
        rula_score: number;
        status: 'good' | 'warning' | 'critical';
        cva_angle: number;
    };
    sensors: {
        neck: { quat: Quaternion };
    };
}

export function usePostureSocket(url: string) {
    const [postureData, setPostureData] = useState<PostureData | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        const ws = new WebSocket(url);

        ws.onopen = () => setIsConnected(true);
        ws.onclose = () => setIsConnected(false);
        ws.onerror = (err) => console.error("WebSocket error", err);
        ws.onmessage = (event) => {
            try {
                const data: PostureData = JSON.parse(event.data);
                setPostureData(data);
            } catch (err) {
                console.error("Failed to parse WebSocket data", err);
            }
        };

        // Cleanup on unmount
        return () => ws.close();
    }, [url]);

    return { postureData, isConnected };
}