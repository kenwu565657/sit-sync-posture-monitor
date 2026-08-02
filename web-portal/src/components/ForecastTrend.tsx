import { useEffect, useMemo, useState } from 'react';
import {
    CartesianGrid,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type {
    ForecastSample,
    PosturePayload,
} from '../hooks/usePostureSocket';

interface ForecastTrendProps {
    history: ForecastSample[];
    metrics?: PosturePayload['metrics'];
}

export default function ForecastTrend({
    history,
    metrics,
}: ForecastTrendProps) {
    const [now, setNow] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(timer);
    }, []);

    const latestTimestamp = history.at(-1)?.generatedAtMs ?? now;
    const data = useMemo(
        () => history.map((sample) => ({
            seconds: (sample.generatedAtMs - latestTimestamp) / 1000,
            probability: sample.probability,
            level: sample.level,
            personalProbability: sample.personalProbability,
        })),
        [history, latestTimestamp],
    );
    const level = metrics?.forecast_level ?? 'CALIBRATING';
    const predictive = level === 'ELEVATED' || level === 'HIGH';
    const deadline =
        (metrics?.forecast_generated_at_ms ?? 0) +
        (metrics?.forecast_horizon_seconds ?? 0) * 1000;
    const secondsRemaining = predictive && now > 0
        ? Math.max(0, (deadline - now) / 1000)
        : 0;

    return (
        <div className="p-5 bg-slate-800 rounded-2xl border border-slate-700">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-slate-400 font-medium uppercase tracking-wider text-xs">
                        Forecast probability · last 60 seconds
                    </p>
                    <p className="mt-2 text-sm text-slate-300">
                        Global model: <strong>{level}</strong>
                        {metrics?.personal_forecast_level && (
                            <>
                                {' · '}Personal model:{' '}
                                <strong>{metrics.personal_forecast_level}</strong>
                            </>
                        )}
                    </p>
                </div>
                {predictive && secondsRemaining > 0 && (
                    <div className={`rounded-xl border px-4 py-2 text-center ${
                        level === 'HIGH'
                            ? 'border-red-500 bg-red-950'
                            : 'border-amber-500 bg-amber-950'
                    }`}>
                        <div className="text-2xl font-black">
                            {secondsRemaining.toFixed(1)}s
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-300">
                            prediction horizon
                        </div>
                    </div>
                )}
            </div>
            {data.length > 1 ? (
                <div className="mt-4 h-44 w-full min-w-0">
                    <ResponsiveContainer
                        width="100%"
                        height="100%"
                        minWidth={0}
                        debounce={50}
                    >
                        <LineChart data={data}>
                            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                            <XAxis
                                dataKey="seconds"
                                domain={[-60, 0]}
                                type="number"
                                tickFormatter={(value) => `${value}s`}
                                stroke="#94a3b8"
                                fontSize={11}
                            />
                            <YAxis
                                domain={[0, 1]}
                                tickFormatter={(value) => `${Math.round(value * 100)}%`}
                                stroke="#94a3b8"
                                fontSize={11}
                                width={42}
                            />
                            <Tooltip
                                formatter={(value) => [
                                    `${Math.round(Number(value) * 100)}%`,
                                    'Probability',
                                ]}
                                labelFormatter={(value) => `${value}s`}
                                contentStyle={{
                                    border: '1px solid #475569',
                                    borderRadius: '8px',
                                    backgroundColor: '#0f172a',
                                }}
                            />
                            {metrics?.forecast_threshold != null && (
                                <ReferenceLine
                                    y={metrics.forecast_threshold}
                                    stroke="#f59e0b"
                                    strokeDasharray="5 4"
                                    label={{ value: 'Elevated', fill: '#fbbf24', fontSize: 10 }}
                                />
                            )}
                            {metrics?.forecast_high_threshold != null && (
                                <ReferenceLine
                                    y={metrics.forecast_high_threshold}
                                    stroke="#ef4444"
                                    strokeDasharray="5 4"
                                    label={{ value: 'High', fill: '#f87171', fontSize: 10 }}
                                />
                            )}
                            <Line
                                type="monotone"
                                dataKey="probability"
                                stroke="#22d3ee"
                                strokeWidth={3}
                                dot={false}
                                isAnimationActive={false}
                            />
                            <Line
                                type="monotone"
                                dataKey="personalProbability"
                                name="Personal"
                                stroke="#a78bfa"
                                strokeWidth={3}
                                dot={false}
                                connectNulls
                                isAnimationActive={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <p className="mt-5 text-sm text-slate-500">
                    {level === 'OFFLINE'
                        ? 'ML service is offline.'
                        : level === 'CALIBRATING' || level === 'COLLECTING'
                          ? 'Collecting enough calibrated frames for forecasting.'
                          : 'Waiting for additional forecast samples.'}
                </p>
            )}
            <div className="mt-3 flex gap-4 text-xs text-slate-400">
                <span><span className="text-cyan-400">━</span> Global model</span>
                {metrics?.personal_forecast_probability != null && (
                    <span><span className="text-violet-400">━</span> Personal model</span>
                )}
            </div>
        </div>
    );
}
