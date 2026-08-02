import { Router, Request, Response } from 'express';
import {
    isPosturePayload,
    processTelemetry,
    resetTelemetryCalibration,
} from '../service/telemetry.js';
import {
    RecordingError,
    recordingStatus,
    startRecording,
    stopRecording,
} from '../service/recording.js';
import { requireAuth } from '../middleware/auth.js';
import { ownsDevice } from '../service/authentication.js';

const router = Router();
router.use(requireAuth);

async function canAccessDevice(req: Request, deviceId: string): Promise<boolean> {
    const principal = req.principal;
    if (!principal) return false;
    return principal.kind === 'device'
        ? principal.deviceId === deviceId
        : ownsDevice(principal.userId, deviceId);
}

router.post('/telemetry', async (req: Request, res: Response) => {
    if (!isPosturePayload(req.body)) {
        res.status(400).json({ error: 'Invalid posture payload' });
        return;
    }
    if (
        req.principal?.kind !== 'device' ||
        req.principal.deviceId !== req.body.device_id ||
        req.principal.userId !== req.body.user_id
    ) {
        res.status(403).json({ error: 'Device credentials do not match payload' });
        return;
    }

    await processTelemetry(req.body, req.principal.userId);
    res.status(200).json({ status: 'streamed' });
});

router.post('/calibration/reset', async (req: Request, res: Response) => {
    const deviceId = req.body?.device_id;
    if (typeof deviceId !== 'string' || !deviceId) {
        res.status(400).json({ error: 'device_id is required' });
        return;
    }
    if (!(await canAccessDevice(req, deviceId))) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    resetTelemetryCalibration(deviceId);
    res.status(200).json({
        status: 'calibration_reset',
        instruction: 'Sit upright and remain still for 5 seconds.',
    });
});

router.post('/recording/start', async (req: Request, res: Response) => {
    const {
        device_id,
        sequence_id,
        participant_id,
        action_id,
        split,
        mounting_mode,
    } = req.body ?? {};
    if (
        typeof device_id !== 'string' ||
        typeof sequence_id !== 'string' ||
        typeof participant_id !== 'string' ||
        typeof action_id !== 'string' ||
        !['train', 'validation', 'test'].includes(split) ||
        !['shoulder_top', 'upper_arm'].includes(mounting_mode)
    ) {
        res.status(400).json({
            error:
                'device_id, sequence_id, participant_id, action_id, valid split and mounting_mode are required',
        });
        return;
    }
    if (!(await canAccessDevice(req, device_id))) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    try {
        const recording = await startRecording({
            deviceId: device_id,
            ownerUserId: req.principal!.userId,
            sequenceId: sequence_id,
            participantId: participant_id,
            actionId: action_id,
            split,
            mountingMode: mounting_mode,
        });
        resetTelemetryCalibration(device_id);
        res.status(201).json({
            status: 'recording',
            instruction: 'Remain upright and still for the first 5 seconds.',
            ...recording,
        });
    } catch (error) {
        res.status(error instanceof RecordingError ? error.statusCode : 409).json({
            error: error instanceof Error ? error.message : 'Could not start recording',
        });
    }
});

router.post('/recording/stop', async (req: Request, res: Response) => {
    const deviceId = req.body?.device_id;
    if (typeof deviceId !== 'string' || !deviceId) {
        res.status(400).json({ error: 'device_id is required' });
        return;
    }
    if (!(await canAccessDevice(req, deviceId))) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    try {
        res.status(200).json({
            status: 'stopped',
            ...(await stopRecording(deviceId)),
        });
    } catch (error) {
        res.status(error instanceof RecordingError ? error.statusCode : 404).json({
            error: error instanceof Error ? error.message : 'Recording not found',
        });
    }
});

router.get('/recording/status/:deviceId', async (req: Request, res: Response) => {
    const parameter = req.params.deviceId;
    const deviceId = Array.isArray(parameter) ? parameter[0] : parameter;
    if (!(await canAccessDevice(req, deviceId))) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    res.status(200).json(recordingStatus(deviceId));
});

export default router;
