import express, { Request, Response } from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

interface Quaternion {
    w: number;
    x: number;
    y: number;
    z: number;
}

interface PosturePayload {
    timestamp: number;
    device_id: string;
    sensors: {
        neck: { quat: Quaternion };
        back?: { quat: Quaternion };
    };
}

// --- WEBSOCKET LOGIC ---
wss.on('connection', (ws: WebSocket) => {
    console.log('New Web Client Connected (Three.js)');
    
    ws.on('close', () => {
        console.log('Client Disconnected');
    });
});

function broadcastToClients(data: PosturePayload) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// --- REST API LOGIC ---
app.post('/api/telemetry', (req: Request, res: Response) => {
    const sensorData = req.body as PosturePayload;
    
    console.log(`📡 Received Data from ${sensorData.device_id}`);

    broadcastToClients(sensorData);

    res.status(200).json({ status: 'success', message: 'Data streamed via TS backend' });
});

// --- START SERVER ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Sit-Sync TS Backend running on port ${PORT}`);
    console.log(`WebSocket server active on ws://localhost:${PORT}`);
});