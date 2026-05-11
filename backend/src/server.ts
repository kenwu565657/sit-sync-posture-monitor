import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { initWebSocket } from './service/websocket.js';
import hardwareRoutes from './route/hardware.js';
import dashboardRoutes from './route/dashboard.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSockets
initWebSocket(server);

// Mount API Routes
app.use('/api', hardwareRoutes);             // Maps to /api/telemetry, /api/calibration
app.use('/api/dashboard', dashboardRoutes);  // Maps to /api/dashboard/today/:userId

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Sit-Sync API running on port ${PORT}`);
});