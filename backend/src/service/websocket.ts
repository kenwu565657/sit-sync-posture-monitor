import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

let wss: WebSocketServer;

export function initWebSocket(server: Server) {
    wss = new WebSocketServer({ server });

    wss.on('connection', (ws: WebSocket) => {
        console.log('Web Client Connected');
        ws.on('close', () => console.log('Web Client Disconnected'));
    });
}

export function broadcastToClients(data: any) {
    if (!wss) return;
    
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}