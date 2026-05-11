# sit-sync-posture-monitor

# 🪑 Sit-Sync: IoT Sitting Posture Monitor

**Sit-Sync** is a multi-sensor IoT system designed to monitor, analyze, and correct workspace posture in real-time. By utilizing a dual-sensor spinal tracking approach and clinical Rapid Upper Limb Assessment (RULA) metrics, the system maps human kinematics to a live 3D web avatar, helping users build healthier sitting habits.

## 📂 Repository Structure

```text
sit-sync-posture-monitor/
│
├── /firmware          # STM32CubeIDE project, FreeRTOS tasks, Sensor Drivers
├── /backend           # Express server, WebSocket setup, Database schemas
├── /web-portal     # React app, Three.js canvas, GLTF model loader
├── /docs              # System architecture diagrams, Circuit schematics
└── README.md
```

## Local Setup
```sh
cd backend
docker-compose up -d
```