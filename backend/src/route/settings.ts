import { Request, Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
    getUserPreferences,
    getPrivacySettings,
    isUserPreferences,
    savePersonalizationConsent,
    saveTrainingConsent,
    saveUserPreferences,
} from '../service/userPreferences.js';
import {
    deletePersonalizationTrainingData,
    getPersonalizationStatus,
    personalizationCollector,
    queuePersonalizationTraining,
} from '../service/personalization.js';
import { errorFields, logger } from '../logger.js';
import type { SensorPlacementMode } from '../types/index.js';

const router = Router();
router.use(requireAuth);

function userId(req: Request, res: Response): string | null {
    if (req.principal?.kind !== 'user') {
        res.status(403).json({ error: 'Forbidden' });
        return null;
    }
    return req.principal.userId;
}

function mountingMode(req: Request): SensorPlacementMode {
    const value = req.body?.mounting_mode ?? req.query.mounting_mode;
    return value === 'upper_arm' ? 'upper_arm' : 'shoulder_top';
}

router.get('/', async (req, res) => {
    const ownerId = userId(req, res);
    if (!ownerId) return;
    try {
        const [preferences, privacy, personalization] = await Promise.all([
            getUserPreferences(ownerId),
            getPrivacySettings(ownerId),
            getPersonalizationStatus(ownerId, mountingMode(req)),
        ]);
        res.status(200).json({
            status: 'success',
            preferences,
            privacy,
            personalization,
            telemetry_training_opt_in: privacy.telemetryTrainingOptIn,
            personalized_model_opt_in: privacy.personalizedModelOptIn,
        });
    } catch (error) {
        logger.error('settings_load_failed', errorFields(error));
        res.status(500).json({ error: 'Failed to load preferences' });
    }
});

router.put('/privacy', async (req, res) => {
    const ownerId = userId(req, res);
    if (!ownerId) return;
    if (typeof req.body?.personalizationConsent !== 'boolean') {
        res.status(400).json({ error: 'personalizationConsent must be boolean' });
        return;
    }
    try {
        const privacy = await savePersonalizationConsent(
            ownerId,
            req.body.personalizationConsent,
        );
        if (!privacy.personalizationConsent) {
            personalizationCollector.dropUser(ownerId);
        }
        res.status(200).json({ status: 'success', privacy });
    } catch (error) {
        logger.error('privacy_settings_save_failed', errorFields(error));
        res.status(500).json({ error: 'Failed to save privacy settings' });
    }
});

router.put('/consent', async (req, res) => {
    const ownerId = userId(req, res);
    if (!ownerId) return;
    if (
        typeof req.body?.telemetry_training_opt_in !== 'boolean' ||
        typeof req.body?.personalized_model_opt_in !== 'boolean'
    ) {
        res.status(400).json({
            error:
                'telemetry_training_opt_in and personalized_model_opt_in must be boolean',
        });
        return;
    }
    try {
        const privacy = await saveTrainingConsent(
            ownerId,
            req.body.telemetry_training_opt_in,
            req.body.personalized_model_opt_in,
        );
        if (!privacy.telemetryTrainingOptIn) {
            personalizationCollector.dropUser(ownerId);
        }
        res.status(200).json({
            status: 'success',
            privacy,
            telemetry_training_opt_in: privacy.telemetryTrainingOptIn,
            personalized_model_opt_in: privacy.personalizedModelOptIn,
        });
    } catch (error) {
        logger.error('training_consent_save_failed', errorFields(error));
        res.status(500).json({ error: 'Failed to save training choices' });
    }
});

router.get('/personalization/status', async (req, res) => {
    const ownerId = userId(req, res);
    if (!ownerId) return;
    try {
        const [privacy, personalization] = await Promise.all([
            getPrivacySettings(ownerId),
            getPersonalizationStatus(ownerId, mountingMode(req)),
        ]);
        res.status(200).json({ status: 'success', privacy, personalization });
    } catch (error) {
        logger.error('personalization_status_load_failed', errorFields(error));
        res.status(500).json({ error: 'Failed to load personalization status' });
    }
});

router.post('/personalization/train', async (req, res) => {
    const ownerId = userId(req, res);
    if (!ownerId) return;
    try {
        const mode = mountingMode(req);
        const training = await queuePersonalizationTraining(ownerId, mode);
        res.status(202).json({
            status: 'queued',
            ...training,
            personalization: await getPersonalizationStatus(ownerId, mode),
        });
    } catch (error) {
        if (error instanceof Error) {
            const responses: Record<string, [number, string]> = {
                PERSONALIZATION_CONSENT_REQUIRED: [403, 'Personalization consent is required'],
                TRAINING_ALREADY_ACTIVE: [409, 'A personalization training job is already active'],
                NO_TRAINING_DATA: [409, 'No personalization training data is available'],
            };
            const response = responses[error.message];
            if (response) {
                res.status(response[0]).json({ error: response[1] });
                return;
            }
        }
        logger.error('personalization_training_queue_failed', errorFields(error));
        res.status(500).json({ error: 'Failed to queue personalization training' });
    }
});

router.delete('/personalization/training-data', async (req, res) => {
    const ownerId = userId(req, res);
    if (!ownerId) return;
    try {
        const deleted = await deletePersonalizationTrainingData(ownerId);
        res.status(200).json({ status: 'success', deleted });
    } catch (error) {
        logger.error('personalization_data_delete_failed', errorFields(error));
        res.status(500).json({ error: 'Failed to delete personalization training data' });
    }
});

router.delete('/training-data', async (req, res) => {
    const ownerId = userId(req, res);
    if (!ownerId) return;
    try {
        const deleted = await deletePersonalizationTrainingData(ownerId);
        res.status(200).json({ status: 'success', deleted });
    } catch (error) {
        logger.error('personalization_data_delete_failed', errorFields(error));
        res.status(500).json({ error: 'Failed to delete personalization training data' });
    }
});

router.put('/', async (req, res) => {
    const ownerId = userId(req, res);
    if (!ownerId) return;
    try {
        const preferences = {
            ...await getUserPreferences(ownerId),
            ...req.body,
        };
        if (!isUserPreferences(preferences)) {
            res.status(400).json({
                error:
                    'Invalid preferences: posture thresholds, forecast model variant, or alert settings are outside supported ranges',
            });
            return;
        }
        res.status(200).json({
            status: 'success',
            preferences: await saveUserPreferences(ownerId, preferences),
        });
    } catch (error) {
        logger.error('settings_save_failed', errorFields(error));
        res.status(500).json({ error: 'Failed to save preferences' });
    }
});

export default router;
