import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import Switch from '@mui/material/Switch';
import { usePostureSocket } from './hooks/usePostureSocket';
import Avatar3D from './components/Avatar3D';

function App() {
    const { postureData, isConnected } = usePostureSocket('ws://localhost:8787');

    return (
        // Tailwind Grid: Splits screen into 2 columns (3D on left, UI on right)
        <div className="flex h-screen w-screen bg-slate-900 text-slate-100 font-sans">
            
            {/* LEFT PANEL: 3D Visualization */}
            <div className="relative flex-grow w-2/3">
                
                {/* Connection Badge (Tailwind styling) */}
                <div className={`absolute top-6 left-6 z-10 px-4 py-2 rounded-full font-bold shadow-lg ${isConnected ? 'bg-green-700 text-green-100' : 'bg-red-700 text-red-100'}`}>
                    {isConnected ? '🟢 Live Sync Active' : '🔴 Disconnected'}
                </div>

                <Canvas camera={{ position: [3, 2, 5], fov: 50 }}>
                    <ambientLight intensity={0.5} />
                    <directionalLight position={[10, 10, 5]} intensity={1} />
                    <Environment preset="city" />
                    <Avatar3D 
                        neckQuat={postureData?.sensors.neck.quat} 
                        status={postureData?.metrics.status} 
                    />
                    <OrbitControls enablePan={false} />
                </Canvas>
            </div>

            {/* RIGHT PANEL: Ergonomic Metrics */}
            <div className="w-1/3 min-w-[400px] p-10 border-l border-slate-700 flex flex-col gap-6 overflow-y-auto">
                
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-3xl font-bold tracking-tight">Sit-Sync Portal</h1>
                    
                    {/* Example of MUI mixing with Tailwind layout */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-400">Auto-Calibrate</span>
                        <Switch color="primary" /> 
                    </div>
                </div>
                
                {/* Metric Card 1 */}
                <div className="p-6 bg-slate-800 rounded-2xl shadow-xl border border-slate-700">
                    <p className="text-slate-400 font-medium uppercase tracking-wider text-sm">Real-Time RULA Score</p>
                    <h2 className="text-6xl font-black mt-2 mb-1">
                        {postureData?.metrics.rula_score || '-'}
                    </h2>
                    <p className="text-lg">
                        Status: <strong className="uppercase text-amber-400">{postureData?.metrics.status || 'Waiting...'}</strong>
                    </p>
                </div>

                {/* Metric Card 2 */}
                <div className="p-6 bg-slate-800 rounded-2xl shadow-xl border border-slate-700">
                    <p className="text-slate-400 font-medium uppercase tracking-wider text-sm">Craniovertebral Angle</p>
                    <h2 className="text-5xl font-bold mt-2">
                        {postureData?.metrics.cva_angle ? `${postureData.metrics.cva_angle.toFixed(1)}°` : '--°'}
                    </h2>
                </div>

            </div>
        </div>
    );
}

export default App;