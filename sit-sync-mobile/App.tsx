import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BleConnectionStatus,
  BleGateway,
  BleScanDevice,
} from './src/ble/bleGateway';
import { mapDevicesByName } from './src/ble/sensorNameMapping';
import { SensorFrameAggregator } from './src/ble/sensorFrameAggregator';
import {
  HARDWARE_SAMPLE_HZ,
  SENSOR_DEVICE_NAMES,
  SERVER_HTTP_URL,
  SERVER_WS_URL,
  TELEMETRY_HZ,
  validateEnvironment,
} from './src/config';
import {
  clearSession,
  enrollGateway,
  loadSession,
  login,
  MobileSession,
  resetPostureCalibration,
} from './src/auth/mobileSession';
import { MobileLoginScreen } from './src/components/MobileLoginScreen';
import { MobileAnalyticsScreen } from './src/components/MobileAnalyticsScreen';
import { MobileSettingsScreen } from './src/components/MobileSettingsScreen';
import {
  requestNotificationPermission,
  showPostureSystemNotification,
  startAndroidMonitoring,
  stopAndroidMonitoring,
} from './src/background/androidMonitoring';
import {
  postureAlert,
  PostureAlert,
  PostureAlertLevel,
  serverPostureAlert,
  shouldApplyTelemetryAlert,
  shouldDeliverTelemetryFeedback,
  shouldVibrate,
} from './src/alerts/postureAlert';
import {
  PredictionCountdownState,
  updatePredictionCountdown,
} from './src/alerts/predictionCountdown';
import { PredictionCountdownCard } from './src/components/PredictionCountdownCard';
import { PilotRecordingCard } from './src/components/PilotRecordingCard';
import { getStableDeviceId } from './src/deviceIdentity';
import { TelemetrySocket } from './src/net/telemetrySocket';
import { formatDerivedCva } from './src/cva';
import {
  BODY_POSITIONS,
  BodyPosition,
  CombinedImuFrame,
  ConnectionState,
  ImuSample,
  PosturePayload,
  SensorPlacementMode,
} from './src/types';
import {
  loadSensorPlacementMode,
  saveSensorPlacementMode,
} from './src/settings/sensorPlacement';
import {
  loadAlertSoundEnabled,
  saveAlertSoundEnabled,
} from './src/settings/alertPreferences';

type PositionViewState = {
  status: BleConnectionStatus | 'idle';
  detail: string;
  deviceId?: string;
  deviceName?: string;
  sample?: ImuSample;
};

type AppTab = 'sensors' | 'history' | 'report' | 'settings';
type BluetoothPermissionState = 'checking' | 'granted' | 'denied';
type BackgroundMonitoringState = 'idle' | 'starting' | 'running' | 'error';

const POSITION_LABELS: Record<BodyPosition, string> = {
  neck: 'Neck',
  lower_back: 'Lower back',
  left_shoulder: 'Left shoulder',
  right_shoulder: 'Right shoulder',
};

function initialPositionStates(): Record<BodyPosition, PositionViewState> {
  return {
    neck: { status: 'idle', detail: 'Not assigned' },
    lower_back: { status: 'idle', detail: 'Not assigned' },
    left_shoulder: { status: 'idle', detail: 'Not assigned' },
    right_shoulder: { status: 'idle', detail: 'Not assigned' },
  };
}

export default function App() {
  const gatewayRef = useRef(new BleGateway());
  const aggregatorRef = useRef(new SensorFrameAggregator());
  const socketRef = useRef<TelemetrySocket | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVibrationAtRef = useRef(0);
  const alertLevelRef = useRef<PostureAlertLevel>('none');
  const serverAlertAtRef = useRef(0);
  const lastServerAlertIdRef = useRef<string | null>(null);
  const alertSoundEnabledRef = useRef(false);
  const lastSynchronizedFrameAtRef = useRef(0);
  const telemetryHealthRef = useRef('Waiting for four fresh sensor samples');

  const [isScanning, setIsScanning] = useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [autoConnectDetail, setAutoConnectDetail] = useState(
    'Ready to connect named sensors',
  );
  const [devices, setDevices] = useState<BleScanDevice[]>([]);
  const [selectedPosition, setSelectedPosition] =
    useState<BodyPosition>('neck');
  const [positions, setPositions] = useState(initialPositionStates);
  const [scanStatus, setScanStatus] = useState('Ready to scan');
  const [synchronizedFrames, setSynchronizedFrames] = useState(0);
  const [latestFrame, setLatestFrame] = useState<CombinedImuFrame | null>(null);
  const [packetsReceived, setPacketsReceived] = useState(0);
  const [telemetryHealth, setTelemetryHealth] = useState(
    telemetryHealthRef.current,
  );
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [cloudState, setCloudState] = useState<ConnectionState>('idle');
  const [activeTab, setActiveTab] = useState<AppTab>('sensors');
  const [gatewayDeviceId, setGatewayDeviceId] = useState<string | null>(null);
  const [isSettingNormalPosture, setIsSettingNormalPosture] = useState(false);
  const [calibrationDetail, setCalibrationDetail] = useState(
    'Connect all four sensors before setting your normal posture.',
  );
  const [bluetoothPermission, setBluetoothPermission] =
    useState<BluetoothPermissionState>(
      Platform.OS === 'android' ? 'checking' : 'granted',
    );
  const [backgroundMonitoring, setBackgroundMonitoring] =
    useState<BackgroundMonitoringState>('idle');
  const [cloudDetail, setCloudDetail] = useState(
    'Initializing gateway identity',
  );
  const [serverFrame, setServerFrame] = useState<PosturePayload | null>(null);
  const [activeAlert, setActiveAlert] = useState<PostureAlert>({
    level: 'none',
    kind: 'normal',
    title: 'Waiting for assessment',
    detail: 'Connect all sensors to begin.',
  });
  const [predictionCountdown, setPredictionCountdown] =
    useState<PredictionCountdownState>({ mode: 'idle' });
  const [session, setSession] = useState<MobileSession | null | undefined>(
    undefined,
  );
  const [mountingMode, setMountingMode] =
    useState<SensorPlacementMode>('shoulder_top');
  const [alertSoundEnabled, setAlertSoundEnabled] = useState(false);

  useEffect(() => {
    runAsync(loadSession().then(setSession));
    runAsync(
      loadSensorPlacementMode().then(mode => {
        setMountingMode(mode);
        aggregatorRef.current.setMountingMode(mode);
      }),
    );
    runAsync(
      loadAlertSoundEnabled().then(enabled => {
        alertSoundEnabledRef.current = enabled;
        setAlertSoundEnabled(enabled);
      }),
    );
  }, []);

  useEffect(() => {
    if (!session) return;
    const intervalMs = 1000 / TELEMETRY_HZ;
    const timer = setInterval(() => {
      const now = Date.now();
      const frame = aggregatorRef.current.snapshot(now);
      if (frame) {
        lastSynchronizedFrameAtRef.current = now;
        if (telemetryHealthRef.current !== '10 Hz stream active') {
          telemetryHealthRef.current = '10 Hz stream active';
          setTelemetryHealth(telemetryHealthRef.current);
        }
        setLatestFrame(frame);
        setSynchronizedFrames(count => count + 1);
        runAsync(socketRef.current?.send(frame) ?? Promise.resolve(false));
      } else if (
        now - lastSynchronizedFrameAtRef.current > 1000 &&
        telemetryHealthRef.current !== 'Waiting for four fresh sensor samples'
      ) {
        telemetryHealthRef.current = 'Waiting for four fresh sensor samples';
        setTelemetryHealth(telemetryHealthRef.current);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const gateway = new BleGateway();
    gatewayRef.current = gateway;
    runAsync(requestBluetoothPermissions());
    let disposed = false;
    runAsync(
      getStableDeviceId()
        .then(async deviceId => {
          if (disposed) return;
          setGatewayDeviceId(deviceId);
          aggregatorRef.current.setIdentity(deviceId, session.user.id);
          const configurationError = validateEnvironment();
          if (configurationError) {
            setCloudState('error');
            setCloudDetail(configurationError);
            return;
          }
          const deviceToken = await enrollGateway(
            SERVER_HTTP_URL,
            session.token,
            deviceId,
          );
          if (disposed) return;
          const socket = new TelemetrySocket({
            httpUrl: SERVER_HTTP_URL,
            wsUrl: SERVER_WS_URL,
            deviceId,
            userId: session.user.id,
            accessToken: deviceToken,
            accessTokenProvider: () =>
              enrollGateway(SERVER_HTTP_URL, session.token, deviceId),
          });
          socket.onStateChange((state, detail) => {
            setCloudState(state);
            setCloudDetail(detail ?? state);
          });
          const deliverPostureFeedback = (
            alert: PostureAlert,
            now: number,
            payload?: PosturePayload,
          ) => {
            if (
              !shouldVibrate(
                alert.level,
                alertLevelRef.current,
                lastVibrationAtRef.current,
                now,
              )
            ) {
              return;
            }
            Vibration.vibrate(
              alert.level === 'critical' ? [0, 350, 180, 350] : 250,
            );
            if (Platform.OS === 'android') {
              runAsync(
                showPostureSystemNotification(
                  alert,
                  payload,
                  alertSoundEnabledRef.current,
                ),
              );
            }
            lastVibrationAtRef.current = now;
          };
          socket.onTelemetry(payload => {
            if (disposed) return;
            const nextAlert = postureAlert(payload);
            const now = Date.now();
            if (shouldApplyTelemetryAlert(serverAlertAtRef.current, now)) {
              if (
                shouldDeliverTelemetryFeedback(
                  nextAlert,
                  serverAlertAtRef.current,
                  now,
                )
              ) {
                deliverPostureFeedback(nextAlert, now, payload);
              }
              alertLevelRef.current = nextAlert.level;
              setActiveAlert(nextAlert);
            }
            setServerFrame(payload);
            setPredictionCountdown(current =>
              updatePredictionCountdown(current, payload, now),
            );
          });
          socket.onAlert(alert => {
            if (disposed) return;
            if (alert.id && alert.id === lastServerAlertIdRef.current) return;
            const nextAlert = serverPostureAlert(alert);
            const now = Date.now();
            deliverPostureFeedback(nextAlert, now);
            lastServerAlertIdRef.current = alert.id ?? null;
            serverAlertAtRef.current = now;
            alertLevelRef.current = nextAlert.level;
            setActiveAlert(nextAlert);
          });
          socketRef.current = socket;
          await socket.connect();
        })
        .catch(error => {
          if (disposed) return;
          setCloudState('error');
          setCloudDetail(
            error instanceof Error
              ? error.message
              : 'Gateway enrollment failed',
          );
        }),
    );
    return () => {
      disposed = true;
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      socketRef.current?.disconnect();
      socketRef.current = null;
      setGatewayDeviceId(null);
      runAsync(gateway.destroy());
    };
  }, [session]);

  const requestBluetoothPermissions = async () => {
    if (Platform.OS !== 'android') {
      setBluetoothPermission('granted');
      return true;
    }
    setBluetoothPermission('checking');
    try {
      const apiLevel = parseInt(Platform.Version.toString(), 10);
      let granted: boolean;
      if (apiLevel < 31) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        granted = result === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
        granted =
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
            PermissionsAndroid.RESULTS.GRANTED;
      }
      setBluetoothPermission(granted ? 'granted' : 'denied');
      return granted;
    } catch {
      setBluetoothPermission('denied');
      return false;
    }
  };

  const startScan = async () => {
    if (isScanning) return;
    const permitted = await requestBluetoothPermissions();
    if (!permitted) {
      setScanStatus('Bluetooth permission denied');
      return;
    }

    setDevices([]);
    setIsScanning(true);
    setScanStatus('Scanning for Bluefruit UART devices…');
    gatewayRef.current.startScan(
      device => {
        setDevices(current => {
          const existing = current.findIndex(item => item.id === device.id);
          if (existing === -1) return [...current, device];
          const updated = [...current];
          updated[existing] = device;
          return updated;
        });
      },
      message => {
        setIsScanning(false);
        setScanStatus(`Scan error: ${message}`);
      },
    );

    scanTimerRef.current = setTimeout(() => {
      gatewayRef.current.stopScan();
      setIsScanning(false);
      setScanStatus('Scan complete');
    }, 8000);
  };

  const handleStatus = (
    position: BodyPosition,
    status: BleConnectionStatus,
    detail: string,
  ) => {
    appendDebug(`${POSITION_LABELS[position]} ${status}: ${detail}`);
    setPositions(current => ({
      ...current,
      [position]: { ...current[position], status, detail },
    }));
    if (status === 'disconnected' || status === 'error') {
      aggregatorRef.current.remove(position);
    }
  };

  const handleSample = (sample: ImuSample) => {
    setPacketsReceived(count => count + 1);
    appendDebug(
      `${new Date(sample.timestamp).toLocaleTimeString()} ` +
        `${POSITION_LABELS[sample.position]} (${sample.deviceName}): ${
          sample.raw
        }`,
    );
    setPositions(current => ({
      ...current,
      [sample.position]: {
        ...current[sample.position],
        status: 'connected',
        detail: `Receiving ${sample.deviceName}`,
        sample,
      },
    }));
    aggregatorRef.current.add(sample);
  };

  const connectDeviceToPosition = async (
    position: BodyPosition,
    device: BleScanDevice,
  ) => {
    setIsScanning(false);
    gatewayRef.current.stopScan();

    setPositions(current => {
      const updated = { ...current };
      for (const otherPosition of BODY_POSITIONS) {
        if (
          otherPosition !== position &&
          current[otherPosition].deviceId === device.id
        ) {
          updated[otherPosition] = { status: 'idle', detail: 'Not assigned' };
          aggregatorRef.current.remove(otherPosition);
        }
      }
      updated[position] = {
        status: 'connecting',
        detail: `Connecting to ${device.name}…`,
        deviceId: device.id,
        deviceName: device.name,
      };
      return updated;
    });

    try {
      await gatewayRef.current.connect(
        position,
        device,
        handleSample,
        handleStatus,
        (callbackPosition, chunk) => {
          appendDebug(
            `${new Date().toLocaleTimeString()} ${
              POSITION_LABELS[callbackPosition]
            } ` + `RX chunk: ${JSON.stringify(chunk)}`,
          );
        },
      );
    } catch {
      // Detailed error is supplied through handleStatus.
    }
  };

  const assignDevice = async (device: BleScanDevice) => {
    await connectDeviceToPosition(selectedPosition, device);
  };

  const connectAllNamedSensors = async () => {
    if (isScanning || isAutoConnecting) return;
    const permitted = await requestBluetoothPermissions();
    if (!permitted) {
      setAutoConnectDetail('Bluetooth permission denied');
      return;
    }

    setIsAutoConnecting(true);
    setIsScanning(true);
    setDevices([]);
    setAutoConnectDetail('Scanning for four named sensors…');
    await gatewayRef.current.disconnectAll();
    aggregatorRef.current.reset();
    setPositions(initialPositionStates());

    const discovered = new Map<string, BleScanDevice>();
    await new Promise<void>(resolve => {
      let completed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (completed) return;
        completed = true;
        if (timer) clearTimeout(timer);
        resolve();
      };

      gatewayRef.current.startScan(
        device => {
          discovered.set(device.id, device);
          const discoveredDevices = [...discovered.values()];
          setDevices(discoveredDevices);
          const mapped = mapDevicesByName(
            discoveredDevices,
            SENSOR_DEVICE_NAMES,
          );
          const foundCount = BODY_POSITIONS.filter(
            position => mapped[position],
          ).length;
          setAutoConnectDetail(`Found ${foundCount}/4 named sensors…`);
          if (foundCount === BODY_POSITIONS.length) finish();
        },
        message => {
          setAutoConnectDetail(`Scan error: ${message}`);
          finish();
        },
      );
      timer = setTimeout(finish, 10000);
      scanTimerRef.current = timer;
    });

    gatewayRef.current.stopScan();
    scanTimerRef.current = null;
    setIsScanning(false);
    const mapped = mapDevicesByName(
      [...discovered.values()],
      SENSOR_DEVICE_NAMES,
    );
    const found = BODY_POSITIONS.filter(position => mapped[position]);
    const missing = BODY_POSITIONS.filter(position => !mapped[position]);

    for (const position of found) {
      setAutoConnectDetail(
        `Connecting ${POSITION_LABELS[position]} (${
          found.indexOf(position) + 1
        }/${found.length})…`,
      );
      await connectDeviceToPosition(
        position,
        mapped[position] as BleScanDevice,
      );
    }

    setIsAutoConnecting(false);
    setAutoConnectDetail(
      missing.length === 0
        ? 'All four sensors connected'
        : `Missing: ${missing
            .map(
              position =>
                `${POSITION_LABELS[position]} (${SENSOR_DEVICE_NAMES[position]})`,
            )
            .join(', ')}`,
    );
  };

  const disconnectPosition = async (position: BodyPosition) => {
    await gatewayRef.current.disconnect(position);
    aggregatorRef.current.remove(position);
    setPositions(current => ({
      ...current,
      [position]: { status: 'idle', detail: 'Not assigned' },
    }));
  };

  const disconnectAll = async () => {
    await stopAndroidMonitoring();
    await gatewayRef.current.disconnectAll();
    aggregatorRef.current.reset();
    setPositions(initialPositionStates());
    setLatestFrame(null);
    setSynchronizedFrames(0);
  };

  const selectMountingMode = async (mode: SensorPlacementMode) => {
    if (connectedCount > 0 || mode === mountingMode) return;
    await saveSensorPlacementMode(mode);
    aggregatorRef.current.setMountingMode(mode);
    setMountingMode(mode);
    setLatestFrame(null);
    setServerFrame(null);
    setSynchronizedFrames(0);
    setCalibrationDetail(
      'Mode changed. Connect all four sensors, then set your normal posture.',
    );
  };

  const appendDebug = useCallback((line: string) => {
    setDebugLines(current => [line, ...current].slice(0, 30));
  }, []);

  const handleLogin = async (email: string, password: string) => {
    const configurationError = validateEnvironment();
    if (configurationError) throw new Error(configurationError);
    setSession(await login(SERVER_HTTP_URL, email, password));
  };

  const handleLogout = async () => {
    socketRef.current?.disconnect();
    await stopAndroidMonitoring();
    await gatewayRef.current.disconnectAll();
    await clearSession();
    aggregatorRef.current.reset();
    setPositions(initialPositionStates());
    setServerFrame(null);
    setActiveAlert({
      level: 'none',
      kind: 'normal',
      title: 'Waiting for assessment',
      detail: 'Connect all sensors to begin.',
    });
    setPredictionCountdown({ mode: 'idle' });
    alertLevelRef.current = 'none';
    lastVibrationAtRef.current = 0;
    serverAlertAtRef.current = 0;
    lastServerAlertIdRef.current = null;
    setActiveTab('sensors');
    setGatewayDeviceId(null);
    setCalibrationDetail(
      'Connect all four sensors before setting your normal posture.',
    );
    setSession(null);
  };

  const setNormalPosture = async () => {
    if (!gatewayDeviceId || !session) {
      setCalibrationDetail('Gateway identity is not ready yet.');
      return;
    }
    setIsSettingNormalPosture(true);
    setCalibrationDetail('Resetting posture calibration…');
    try {
      const instruction = await resetPostureCalibration(
        SERVER_HTTP_URL,
        session.token,
        gatewayDeviceId,
      );
      setCalibrationDetail(instruction);
      setServerFrame(null);
      setActiveAlert({
        level: 'none',
        kind: 'normal',
        title: 'Calibrating normal posture',
        detail: instruction,
      });
      setPredictionCountdown({ mode: 'idle' });
      alertLevelRef.current = 'none';
      serverAlertAtRef.current = 0;
      lastServerAlertIdRef.current = null;
    } catch (error) {
      setCalibrationDetail(
        error instanceof Error
          ? error.message
          : 'Could not set normal posture.',
      );
    } finally {
      setIsSettingNormalPosture(false);
    }
  };

  const connectedCount = BODY_POSITIONS.filter(
    position => positions[position].status === 'connected',
  ).length;

  const enableBackgroundAlerts = useCallback(async () => {
    setBackgroundMonitoring('starting');
    try {
      if (!(await requestNotificationPermission())) {
        throw new Error('Notification permission denied');
      }
      await startAndroidMonitoring();
      setBackgroundMonitoring('running');
    } catch (error) {
      setBackgroundMonitoring('error');
      appendDebug(
        `Background monitoring failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }, [appendDebug]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (connectedCount === BODY_POSITIONS.length) {
      runAsync(enableBackgroundAlerts());
    } else {
      setBackgroundMonitoring('idle');
      runAsync(stopAndroidMonitoring());
    }
  }, [connectedCount, enableBackgroundAlerts]);

  if (session === undefined) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color="#22d3ee" size="large" />
        <Text style={styles.loadingText}>Loading SitSync…</Text>
      </SafeAreaView>
    );
  }

  if (session === null) {
    return <MobileLoginScreen onLogin={handleLogin} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {activeTab === 'sensors' ? (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.brandRow}>
            <Image
              accessibilityIgnoresInvertColors
              source={require('./src/assets/sit-sync-logo.png')}
              style={styles.brandLogo}
            />
            <Text style={styles.header}>SitSync Sensor Gateway</Text>
          </View>
          <Text style={styles.subtitle}>
            Four BNO085 devices · Nordic UART · {HARDWARE_SAMPLE_HZ} Hz
          </Text>
          <View style={styles.accountRow}>
            <Text style={styles.accountText}>
              Signed in as {session.user.name}
            </Text>
            <TouchableOpacity
              onPress={() => {
                runAsync(handleLogout());
              }}
            >
              <Text style={styles.logoutText}>Log out</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{connectedCount}/4</Text>
            <Text style={styles.summaryLabel}>sensors connected</Text>
            <Text style={styles.summaryMeta}>
              Synchronized frames: {synchronizedFrames}
            </Text>
            <Text style={styles.summaryMeta}>
              BLE packets received: {packetsReceived}
            </Text>
            <Text style={styles.summaryMeta}>Telemetry: {telemetryHealth}</Text>
            <Text style={styles.summaryMeta}>
              Cloud: {cloudState.toUpperCase()} · {cloudDetail}
            </Text>
            {Platform.OS === 'android' && (
              <Text style={styles.summaryMeta}>
                Background alerts: {backgroundMonitoring.toUpperCase()}
              </Text>
            )}
            <Text style={styles.summaryMeta}>
              Latest frame:{' '}
              {latestFrame
                ? new Date(latestFrame.timestamp).toLocaleTimeString()
                : 'waiting'}
            </Text>
          </View>

          <View style={styles.modeCard}>
            <Text style={styles.modeTitle}>Sensor mounting mode</Text>
            <Text style={styles.modeDetail}>
              Select before connecting and calibrating. Recordings and models
              from different modes cannot be mixed.
            </Text>
            <View style={styles.modeButtons}>
              {(
                [
                  ['shoulder_top', 'Shoulder top · posture'],
                  ['upper_arm', 'Middle deltoid · arm'],
                ] as const
              ).map(([mode, label]) => (
                <TouchableOpacity
                  key={mode}
                  disabled={connectedCount > 0}
                  onPress={() => runAsync(selectMountingMode(mode))}
                  style={[
                    styles.modeButton,
                    mountingMode === mode && styles.modeButtonActive,
                    connectedCount > 0 && styles.modeButtonDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      mountingMode === mode && styles.modeButtonTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {connectedCount > 0 && (
              <Text style={styles.modeLocked}>
                Disconnect all sensors to change mode.
              </Text>
            )}
          </View>

          {Platform.OS === 'android' && bluetoothPermission !== 'granted' && (
            <View style={styles.permissionCard}>
              <View style={styles.permissionCopy}>
                <Text style={styles.permissionTitle}>
                  Bluetooth permission required
                </Text>
                <Text style={styles.permissionDetail}>
                  SitSync needs Nearby devices access to scan and connect to
                  your four posture sensors.
                </Text>
              </View>
              {bluetoothPermission === 'checking' ? (
                <ActivityIndicator color="#22d3ee" />
              ) : (
                <View style={styles.permissionActions}>
                  <TouchableOpacity
                    style={styles.permissionButton}
                    onPress={() => runAsync(requestBluetoothPermissions())}
                  >
                    <Text style={styles.permissionButtonText}>Allow</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => runAsync(Linking.openSettings())}
                  >
                    <Text style={styles.settingsLink}>Open settings</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {Platform.OS === 'android' &&
            connectedCount === BODY_POSITIONS.length &&
            backgroundMonitoring === 'error' && (
              <View style={styles.permissionCard}>
                <View style={styles.permissionCopy}>
                  <Text style={styles.permissionTitle}>
                    Enable background alerts
                  </Text>
                  <Text style={styles.permissionDetail}>
                    Allow notifications so Android can keep posture monitoring
                    active when SitSync is not on screen.
                  </Text>
                </View>
                <View style={styles.permissionActions}>
                  <TouchableOpacity
                    style={styles.permissionButton}
                    onPress={() => runAsync(enableBackgroundAlerts())}
                  >
                    <Text style={styles.permissionButtonText}>Allow</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => runAsync(Linking.openSettings())}
                  >
                    <Text style={styles.settingsLink}>Open settings</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

          <View
            style={[
              styles.alertCard,
              activeAlert.level === 'warning' && styles.alertCardWarning,
              activeAlert.level === 'critical' && styles.alertCardCritical,
            ]}
          >
            <View style={styles.alertHeader}>
              <Text style={styles.alertTitle}>{activeAlert.title}</Text>
              <Text style={styles.alertBadge}>
                {activeAlert.level.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.alertDetail}>{activeAlert.detail}</Text>
            {serverFrame?.metrics && (
              <View>
                <Text style={styles.alertMetrics}>
                  Estimated RULA: {serverFrame.metrics.rula_score ?? '—'}
                </Text>
                <Text style={styles.alertMetrics}>
                  Derived CVA-like:{' '}
                  {formatDerivedCva(serverFrame.metrics.cva_angle)} · lower is
                  worse
                </Text>
                <Text style={styles.alertMetrics}>
                  Global forecast: {serverFrame.metrics.forecast_level ?? '—'}
                  {serverFrame.metrics.forecast_probability == null
                    ? ''
                    : ` · ${Math.round(
                        serverFrame.metrics.forecast_probability * 100,
                      )}%`}
                </Text>
                {(serverFrame.metrics.personal_forecast_probability != null ||
                  serverFrame.metrics.personal_forecast_status) && (
                  <Text style={styles.personalForecastMetrics}>
                    Personal forecast:{' '}
                    {serverFrame.metrics.personal_forecast_level ??
                      serverFrame.metrics.personal_forecast_status ??
                      '—'}
                    {serverFrame.metrics.personal_forecast_probability == null
                      ? ''
                      : ` · ${Math.round(
                          serverFrame.metrics.personal_forecast_probability *
                            100,
                        )}%`}
                  </Text>
                )}
              </View>
            )}
            <Text style={styles.alertFootnote}>
              System alert · vibration repeats after a 30-second cooldown
            </Text>
          </View>

          <PredictionCountdownCard state={predictionCountdown} />

          <View style={styles.calibrationCard}>
            <View style={styles.calibrationCopy}>
              <Text style={styles.calibrationTitle}>Normal posture</Text>
              <Text style={styles.calibrationDetail}>{calibrationDetail}</Text>
            </View>
            <TouchableOpacity
              disabled={
                connectedCount < 4 ||
                cloudState !== 'connected' ||
                isSettingNormalPosture
              }
              onPress={() => runAsync(setNormalPosture())}
              style={[
                styles.calibrationButton,
                (connectedCount < 4 ||
                  cloudState !== 'connected' ||
                  isSettingNormalPosture) &&
                  styles.buttonDisabled,
              ]}
            >
              {isSettingNormalPosture ? (
                <ActivityIndicator color="#083344" size="small" />
              ) : (
                <Text style={styles.calibrationButtonText}>
                  Set normal posture
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <PilotRecordingCard
            baseUrl={SERVER_HTTP_URL}
            token={session.token}
            deviceId={gatewayDeviceId}
            sensorsConnected={connectedCount}
            cloudConnected={cloudState === 'connected'}
            mountingMode={mountingMode}
          />

          <Text style={styles.sectionTitle}>Quick connection</Text>
          <TouchableOpacity
            disabled={isAutoConnecting || isScanning}
            onPress={() => {
              runAsync(connectAllNamedSensors());
            }}
            style={[
              styles.autoConnectButton,
              (isAutoConnecting || isScanning) && styles.buttonDisabled,
            ]}
          >
            {isAutoConnecting ? (
              <ActivityIndicator color="#082f49" />
            ) : (
              <Text style={styles.autoConnectButtonText}>
                Connect all four sensors
              </Text>
            )}
          </TouchableOpacity>
          <Text style={styles.autoConnectDetail}>{autoConnectDetail}</Text>
          <View style={styles.nameMapCard}>
            {BODY_POSITIONS.map(position => (
              <View key={position} style={styles.nameMapRow}>
                <Text style={styles.nameMapPosition}>
                  {POSITION_LABELS[position]}
                </Text>
                <Text style={styles.nameMapDevice}>
                  {SENSOR_DEVICE_NAMES[position]}
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Manual assignment</Text>
          <Text style={styles.helper}>
            Use this fallback if a named sensor is missing or has been renamed.
          </Text>
          <View style={styles.positionGrid}>
            {BODY_POSITIONS.map(position => {
              const state = positions[position];
              const selected = selectedPosition === position;
              return (
                <TouchableOpacity
                  key={position}
                  style={[
                    styles.positionCard,
                    selected && styles.positionSelected,
                    state.status === 'connected' && styles.positionConnected,
                  ]}
                  onPress={() => setSelectedPosition(position)}
                >
                  <Text style={styles.positionName}>
                    {POSITION_LABELS[position]}
                  </Text>
                  <Text style={styles.positionDevice}>
                    {state.deviceName ?? 'Choose a device'}
                  </Text>
                  <Text
                    style={[
                      styles.positionStatus,
                      state.status === 'connected' && styles.textConnected,
                      state.status === 'error' && styles.textError,
                    ]}
                  >
                    {state.status.toUpperCase()}
                  </Text>
                  {state.sample && <SamplePreview sample={state.sample} />}
                  {state.status !== 'idle' && (
                    <TouchableOpacity
                      style={styles.disconnectSmall}
                      onPress={() => runAsync(disconnectPosition(position))}
                    >
                      <Text style={styles.disconnectSmallText}>Disconnect</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Scan and assign one device</Text>
          <Text style={styles.helper}>
            Selected: {POSITION_LABELS[selectedPosition]}. Tap a Device card to
            assign it.
          </Text>
          <TouchableOpacity
            style={[styles.scanButton, isScanning && styles.buttonDisabled]}
            onPress={() => runAsync(startScan())}
            disabled={isScanning}
          >
            <Text style={styles.buttonText}>
              {isScanning ? 'Scanning…' : 'Scan BLE Devices'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.scanStatus}>{scanStatus}</Text>

          {devices.map(device => (
            <TouchableOpacity
              key={device.id}
              style={styles.deviceCard}
              onPress={() => runAsync(assignDevice(device))}
            >
              <View>
                <Text style={styles.deviceName}>{device.name}</Text>
                <Text style={styles.deviceId}>{device.id}</Text>
              </View>
              <Text style={styles.rssi}>
                {device.rssi == null ? '--' : `${device.rssi} dBm`}
              </Text>
            </TouchableOpacity>
          ))}

          {!isScanning && devices.length === 0 && (
            <Text style={styles.empty}>
              Power on the four Device peripherals, then scan.
            </Text>
          )}

          {connectedCount > 0 && (
            <TouchableOpacity
              style={styles.disconnectAll}
              onPress={() => runAsync(disconnectAll())}
            >
              <Text style={styles.buttonText}>Disconnect All</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.debugToggle}
            onPress={() => setDebugVisible(visible => !visible)}
          >
            <Text style={styles.debugToggleText}>
              {debugVisible ? 'Hide Packet Debug' : 'Show Packet Debug'}
            </Text>
          </TouchableOpacity>

          {debugVisible && (
            <View style={styles.debugPanel}>
              <View style={styles.debugHeader}>
                <Text style={styles.debugTitle}>
                  Live BLE packets (newest first)
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setDebugLines([]);
                    setPacketsReceived(0);
                  }}
                >
                  <Text style={styles.clearText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {debugLines.length === 0 ? (
                <Text style={styles.debugEmpty}>
                  Connect a sensor to see firmware quaternion packets.
                </Text>
              ) : (
                debugLines.map((line, index) => (
                  <Text
                    key={`${index}-${line}`}
                    selectable
                    style={styles.debugLine}
                  >
                    {line}
                  </Text>
                ))
              )}
            </View>
          )}

          <View style={styles.note}>
            <Text style={styles.noteTitle}>Realtime posture forwarding</Text>
            <Text style={styles.noteText}>
              Four game-rotation quaternions are synchronized into one versioned
              posture frame and forwarded through the authenticated cloud
              socket.
            </Text>
          </View>
        </ScrollView>
      ) : activeTab === 'settings' ? (
        <MobileSettingsScreen
          baseUrl={SERVER_HTTP_URL}
          token={session.token}
          mountingMode={mountingMode}
          alertSoundEnabled={alertSoundEnabled}
          onAlertSoundEnabledChange={async enabled => {
            await saveAlertSoundEnabled(enabled);
            alertSoundEnabledRef.current = enabled;
            setAlertSoundEnabled(enabled);
          }}
          onUnauthorized={() => {
            runAsync(handleLogout());
          }}
        />
      ) : (
        <MobileAnalyticsScreen
          mode={activeTab}
          baseUrl={SERVER_HTTP_URL}
          token={session.token}
          userName={session.user.name}
          onUnauthorized={() => {
            runAsync(handleLogout());
          }}
        />
      )}
      <View style={styles.bottomBar}>
        <BottomTab
          label="Sensors"
          icon="◉"
          active={activeTab === 'sensors'}
          onPress={() => setActiveTab('sensors')}
        />
        <BottomTab
          label="History"
          icon="◷"
          active={activeTab === 'history'}
          onPress={() => setActiveTab('history')}
        />
        <BottomTab
          label="Report"
          icon="▤"
          active={activeTab === 'report'}
          onPress={() => setActiveTab('report')}
        />
        <BottomTab
          label="Settings"
          icon="⚙"
          active={activeTab === 'settings'}
          onPress={() => setActiveTab('settings')}
        />
      </View>
    </SafeAreaView>
  );
}

function BottomTab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.bottomTab} onPress={onPress}>
      <Text style={[styles.bottomTabIcon, active && styles.bottomTabActive]}>
        {icon}
      </Text>
      <Text style={[styles.bottomTabLabel, active && styles.bottomTabActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function SamplePreview({ sample }: { sample: ImuSample }) {
  const quaternion = sample.quaternion;
  return (
    <View style={styles.sample}>
      <Text style={styles.sampleText}>
        Q {quaternion.x.toFixed(3)}, {quaternion.y.toFixed(3)},{' '}
        {quaternion.z.toFixed(3)}, {quaternion.w.toFixed(3)}
      </Text>
      <Text style={styles.sampleMeta}>
        Accuracy {sample.accuracy}/3 · Packet #{sample.sequence}
      </Text>
    </View>
  );
}

function runAsync(task: Promise<unknown>): void {
  task.catch(error => console.error(error));
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  bottomBar: {
    flexDirection: 'row',
    minHeight: 64,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingTop: 7,
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 5,
  },
  bottomTabIcon: { color: '#64748b', fontSize: 21, lineHeight: 23 },
  bottomTabLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  bottomTabActive: { color: '#22d3ee' },
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: '#020617',
    flex: 1,
    justifyContent: 'center',
  },
  loadingText: { color: '#94a3b8', marginTop: 12 },
  container: { padding: 18, paddingBottom: 48 },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
  },
  brandLogo: { borderRadius: 12, height: 48, marginRight: 12, width: 48 },
  header: {
    color: 'white',
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  accountRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  accountText: { color: '#cbd5e1', fontSize: 13 },
  logoutText: { color: '#38bdf8', fontSize: 13, fontWeight: '800' },
  summaryCard: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  summaryValue: { color: '#38bdf8', fontSize: 38, fontWeight: '900' },
  summaryLabel: { color: '#e2e8f0', fontWeight: '700' },
  summaryMeta: { color: '#94a3b8', marginTop: 4, fontSize: 12 },
  modeCard: {
    backgroundColor: '#111827',
    borderColor: '#0e7490',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
  },
  modeTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '900' },
  modeDetail: { color: '#94a3b8', fontSize: 11, lineHeight: 16, marginTop: 4 },
  modeButtons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  modeButton: {
    borderColor: '#475569',
    borderRadius: 9,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  modeButtonActive: { backgroundColor: '#164e63', borderColor: '#22d3ee' },
  modeButtonDisabled: { opacity: 0.65 },
  modeButtonText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  modeButtonTextActive: { color: '#cffafe' },
  modeLocked: { color: '#fbbf24', fontSize: 10, marginTop: 8 },
  permissionCard: {
    alignItems: 'center',
    backgroundColor: '#422006',
    borderColor: '#f59e0b',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    padding: 14,
  },
  permissionCopy: { flex: 1 },
  permissionTitle: { color: '#fef3c7', fontSize: 14, fontWeight: '900' },
  permissionDetail: {
    color: '#fde68a',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  permissionActions: { alignItems: 'center', gap: 7 },
  permissionButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  permissionButtonText: { color: '#422006', fontSize: 12, fontWeight: '900' },
  settingsLink: { color: '#fde68a', fontSize: 10, fontWeight: '700' },
  alertCard: {
    marginTop: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    backgroundColor: '#172033',
  },
  alertCardWarning: {
    borderColor: '#f59e0b',
    backgroundColor: '#3b2a12',
  },
  alertCardCritical: {
    borderColor: '#ef4444',
    backgroundColor: '#451a1a',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  alertTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '900' },
  alertBadge: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  alertDetail: { color: '#e2e8f0', marginTop: 8, lineHeight: 20 },
  alertMetrics: { color: '#cbd5e1', marginTop: 10, fontSize: 12 },
  personalForecastMetrics: {
    color: '#c4b5fd',
    fontSize: 12,
    marginTop: 4,
  },
  alertFootnote: { color: '#94a3b8', marginTop: 6, fontSize: 11 },
  calibrationCard: {
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    padding: 14,
  },
  calibrationCopy: { flex: 1 },
  calibrationTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '900' },
  calibrationDetail: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  calibrationButton: {
    alignItems: 'center',
    backgroundColor: '#22d3ee',
    borderRadius: 9,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  calibrationButtonText: {
    color: '#083344',
    fontSize: 12,
    fontWeight: '900',
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 20,
    marginBottom: 8,
  },
  autoConnectButton: {
    alignItems: 'center',
    backgroundColor: '#22d3ee',
    borderRadius: 12,
    minHeight: 50,
    justifyContent: 'center',
    padding: 14,
  },
  autoConnectButtonText: {
    color: '#083344',
    fontSize: 16,
    fontWeight: '900',
  },
  autoConnectDetail: {
    color: '#94a3b8',
    marginBottom: 10,
    marginTop: 8,
    textAlign: 'center',
  },
  nameMapCard: {
    backgroundColor: '#111827',
    borderColor: '#334155',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  nameMapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  nameMapPosition: { color: '#cbd5e1', fontSize: 12 },
  nameMapDevice: {
    color: '#67e8f9',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  helper: { color: '#94a3b8', marginBottom: 10 },
  positionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  positionCard: {
    width: '48%',
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  positionSelected: { borderColor: '#38bdf8', borderWidth: 2 },
  positionConnected: { backgroundColor: '#123127', borderColor: '#22c55e' },
  positionName: { color: 'white', fontWeight: '800', fontSize: 15 },
  positionDevice: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  positionStatus: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 7,
  },
  textConnected: { color: '#4ade80' },
  textError: { color: '#f87171' },
  sample: { marginTop: 8 },
  sampleText: { color: '#cbd5e1', fontSize: 10, fontFamily: 'monospace' },
  sampleMeta: { color: '#64748b', fontSize: 9, marginTop: 3 },
  disconnectSmall: {
    marginTop: 8,
    paddingVertical: 5,
    alignItems: 'center',
    backgroundColor: '#7f1d1d',
    borderRadius: 6,
  },
  disconnectSmallText: { color: '#fecaca', fontSize: 11, fontWeight: '700' },
  scanButton: {
    backgroundColor: '#0284c7',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#475569' },
  buttonText: { color: 'white', fontWeight: '800', fontSize: 16 },
  scanStatus: {
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  deviceCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 13,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  deviceName: { color: 'white', fontWeight: '800', fontSize: 16 },
  deviceId: { color: '#64748b', fontSize: 11, marginTop: 3, maxWidth: 270 },
  rssi: { color: '#38bdf8', fontWeight: '700' },
  empty: {
    color: '#64748b',
    textAlign: 'center',
    paddingVertical: 24,
  },
  disconnectAll: {
    backgroundColor: '#b91c1c',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 18,
  },
  debugToggle: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    backgroundColor: '#1e293b',
  },
  debugToggleText: { color: '#67e8f9', fontWeight: '800' },
  debugPanel: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#020617',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  debugTitle: { color: '#cbd5e1', fontWeight: '800', fontSize: 12 },
  clearText: { color: '#38bdf8', fontWeight: '700', fontSize: 12 },
  debugEmpty: { color: '#64748b', fontSize: 11 },
  debugLine: {
    color: '#4ade80',
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
    marginBottom: 4,
  },
  note: {
    marginTop: 22,
    padding: 14,
    backgroundColor: '#172554',
    borderRadius: 10,
  },
  noteTitle: { color: '#bfdbfe', fontWeight: '800', marginBottom: 4 },
  noteText: { color: '#93c5fd', fontSize: 13, lineHeight: 19 },
});
