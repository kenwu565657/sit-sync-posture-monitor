import { useState } from "react";
import { Button } from "@mui/material";
import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import Avatar3D from "../components/Avatar3D";
import ForecastTrend from "../components/ForecastTrend";
import { getWebToken } from "../auth/webSession";
import { apiUrl } from "../config/env";
import { usePostureSocket } from "../hooks/usePostureSocket";

function StreamPage() {
    const [calibrationRevision, setCalibrationRevision] = useState(0);
    const [isCalibrated, setIsCalibrated] = useState(false);
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [calibrationMessage, setCalibrationMessage] = useState(
        'Sit neutral, then calibrate',
    );
    const {
        postureData,
        connectionState,
        isConnected,
        isStale,
        lastUpdate,
        forecastHistory,
        serverAlert,
    } = usePostureSocket();
    const forecast = postureData?.metrics?.forecast_probability;
    const forecastLevel = postureData?.metrics?.forecast_level ?? 'CALIBRATING';
    const personalForecast =
        postureData?.metrics?.personal_forecast_probability;
    const personalForecastLevel =
        postureData?.metrics?.personal_forecast_level;
    const forecastWarning = forecastLevel === 'HIGH' || forecastLevel === 'ELEVATED';
    const connectionLabel = {
        connecting: 'Connecting…',
        connected: isStale ? 'Live data stale' : 'Live sync active',
        reconnecting: 'Reconnecting…',
        disconnected: 'Disconnected',
    }[connectionState];
    const connectionStyle = isConnected && !isStale
        ? 'bg-green-700 text-green-100'
        : connectionState === 'connecting' || connectionState === 'reconnecting' || isStale
          ? 'bg-amber-700 text-amber-100'
          : 'bg-red-700 text-red-100';
    const calibrate = async () => {
        const deviceId = postureData?.device_id;
        const token = getWebToken();
        if (!deviceId || !token || isCalibrating) return;
        setIsCalibrating(true);
        setIsCalibrated(false);
        setCalibrationMessage('Resetting assessment calibration…');
        try {
            const response = await fetch(apiUrl('/api/calibration/reset'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ device_id: deviceId }),
            });
            if (!response.ok) {
                throw new Error(`Calibration reset failed (${response.status})`);
            }
            const result = await response.json() as { instruction?: unknown };
            setCalibrationRevision((revision) => revision + 1);
            setCalibrationMessage(
                typeof result.instruction === 'string'
                    ? result.instruction
                    : 'Sit upright and remain still for 5 seconds.',
            );
            await new Promise((resolve) => setTimeout(resolve, 5_000));
            setIsCalibrated(true);
            setCalibrationMessage('Assessment and avatar calibrated');
        } catch (error) {
            setCalibrationMessage(
                error instanceof Error
                    ? error.message
                    : 'Calibration reset failed',
            );
        } finally {
            setIsCalibrating(false);
        }
    };
    
        return (
            <div className="flex h-[calc(100dvh-110px)] min-h-[760px] w-full min-w-0 flex-col bg-slate-900 font-sans text-slate-100">
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 px-6 py-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">
                            Sit-Sync Live Monitor
                        </h1>
                        <p className="mt-1 text-sm text-slate-400">
                            Live posture, movement and five-second risk forecast
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-4">
                        <div className={`rounded-xl px-4 py-2 font-bold shadow-lg ${connectionStyle}`}>
                            <div>{connectionLabel}</div>
                            <div className="mt-1 text-xs font-normal opacity-90">
                                Last update: {lastUpdate
                                    ? lastUpdate.toLocaleTimeString()
                                    : 'Waiting for data'}
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <Button
                                variant="contained"
                                size="small"
                                onClick={() => void calibrate()}
                                disabled={!postureData || isStale || isCalibrating}
                            >
                                {isCalibrating
                                    ? 'Calibrating…'
                                    : 'Calibrate neutral pose'}
                            </Button>
                            <span className={`text-xs ${
                                isCalibrated ? 'text-green-400' : 'text-slate-400'
                            }`}>
                                {calibrationMessage}
                            </span>
                        </div>
                    </div>
                </header>

                {serverAlert && (
                    <div
                        role="alert"
                        className={`mx-6 mt-4 rounded-2xl border px-5 py-4 shadow-xl ${
                            serverAlert.level === 'critical'
                                ? 'border-red-500 bg-red-950'
                                : serverAlert.level === 'warning'
                                  ? 'border-amber-500 bg-amber-950'
                                  : 'border-emerald-500 bg-emerald-950'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <strong className="text-lg">{serverAlert.title}</strong>
                            <span className="text-xs font-bold uppercase tracking-wide">
                                Server alert
                            </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-100">
                            {serverAlert.detail}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                            {serverAlert.event === 'resolved'
                                ? 'Resolved'
                                : serverAlert.kind === 'prediction'
                                  ? 'Predicted risk'
                                  : 'Detected posture'}
                            {' · '}
                            {new Date(serverAlert.timestamp).toLocaleTimeString()}
                        </p>
                    </div>
                )}

                <section className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 lg:grid-cols-[0.8fr_0.8fr_1.15fr_1.65fr]">
                    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-xl">
                        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                            Real-Time Estimated RULA
                        </p>
                        <h2 className="mb-1 mt-2 text-5xl font-black">
                            {postureData?.metrics?.rula_score ?? '-'}
                        </h2>
                        <p>
                            Status:{' '}
                            <strong className="uppercase text-amber-400">
                                {postureData?.metrics?.status || 'Waiting...'}
                            </strong>
                        </p>
                    </div>

                    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-xl">
                        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                            Derived CVA
                        </p>
                        <h2 className="mt-2 text-5xl font-bold">
                            {postureData?.metrics?.cva_angle == null
                                ? '—'
                                : `${postureData.metrics.cva_angle.toFixed(1)}°`}
                        </h2>
                        <p className="mt-2 text-sm text-slate-400">
                            CVA-like angle from calibrated IMU orientation
                        </p>
                    </div>

                    <div className={`rounded-2xl border p-5 shadow-xl ${
                        forecastWarning
                            ? 'border-red-500 bg-red-950'
                            : 'border-slate-700 bg-slate-800'
                    }`}>
                        <p className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-400">
                            Bad Posture Forecast (5s)
                            <span className="relative flex h-3 w-3">
                                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                                    forecastWarning ? 'bg-red-400' : 'bg-cyan-400'
                                }`}></span>
                                <span className={`relative inline-flex h-3 w-3 rounded-full ${
                                    forecastWarning ? 'bg-red-500' : 'bg-cyan-500'
                                }`}></span>
                            </span>
                        </p>
                        <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                    Global model
                                </p>
                                <h2 className={`mt-1 text-4xl font-bold ${
                                    forecastWarning ? 'text-red-400' : 'text-cyan-400'
                                }`}>
                                    {forecast == null
                                        ? '--'
                                        : `${Math.round(forecast * 100)}%`}
                                </h2>
                                <p className="mt-1 text-sm">
                                    Risk: <strong>{forecastLevel}</strong>
                                </p>
                            </div>
                            {personalForecast != null && (
                                <div className="border-l border-slate-600 pl-5">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">
                                        Personal
                                    </p>
                                    <p className="mt-1 text-3xl font-bold text-violet-400">
                                        {Math.round(personalForecast * 100)}%
                                    </p>
                                    <p className="mt-1 text-sm">
                                        Risk:{' '}
                                        <strong>
                                            {personalForecastLevel ?? 'AVAILABLE'}
                                        </strong>
                                    </p>
                                </div>
                            )}
                        </div>
                        {personalForecast == null &&
                            postureData?.metrics?.personal_forecast_status && (
                                <p className="mt-3 text-sm text-slate-400">
                                    Personal model:{' '}
                                    {postureData.metrics.personal_forecast_status}
                                </p>
                            )}
                        {forecastWarning && (
                            <p className="mt-2 font-bold text-red-300">
                                Adjust your posture before risk increases.
                            </p>
                        )}
                    </div>

                    <ForecastTrend
                        history={forecastHistory}
                        metrics={postureData?.metrics}
                    />
                </section>

                <div className="relative min-h-0 min-w-0 flex-1 border-t border-slate-700">
                    <Canvas camera={{ position: [3, 2, 5], fov: 50 }}>
                        <ambientLight intensity={0.5} />
                        <directionalLight position={[10, 10, 5]} intensity={1} />
                        <Environment preset="city" />
                        <group position={[0, -2.2, 0]}>
                            <Avatar3D
                                sensors={postureData?.sensors}
                                scale={3}
                                mountingMode={
                                    postureData?.mounting_mode ?? 'shoulder_top'
                                }
                                enableCalibration
                                calibrationRevision={calibrationRevision}
                            />
                        </group>
                        <OrbitControls enablePan={false} />
                    </Canvas>
                </div>
            </div>
        );
}

export default StreamPage;