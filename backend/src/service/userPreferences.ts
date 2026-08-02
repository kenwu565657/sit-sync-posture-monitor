import pool from '../db.js';

export interface UserPreferences {
    warningRulaThreshold: number;
    warningCvaThreshold: number;
    incidentDurationSeconds: number;
    forecastModelVariant: ForecastModelVariant;
    alertConsecutivePredictions: number;
    alertCooldownSeconds: number;
}

export type ForecastModelVariant = 'rula' | 'combined_strict';

export interface PrivacySettings {
    personalizationConsent: boolean;
    telemetryTrainingOptIn: boolean;
    personalizedModelOptIn: boolean;
    consentUpdatedAt: string | null;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
    warningRulaThreshold: 2,
    warningCvaThreshold: 50,
    incidentDurationSeconds: 15,
    forecastModelVariant: 'rula',
    alertConsecutivePredictions: 2,
    alertCooldownSeconds: 300,
};

const cache = new Map<string, UserPreferences>();
const privacyCache = new Map<string, PrivacySettings>();

export function isUserPreferences(value: unknown): value is UserPreferences {
    if (!value || typeof value !== 'object') return false;
    const preferences = value as Record<string, unknown>;
    return (
        Number.isInteger(preferences.warningRulaThreshold) &&
        (preferences.warningRulaThreshold as number) >= 2 &&
        (preferences.warningRulaThreshold as number) <= 6 &&
        Number.isInteger(preferences.warningCvaThreshold) &&
        (preferences.warningCvaThreshold as number) >= 20 &&
        (preferences.warningCvaThreshold as number) <= 60 &&
        Number.isInteger(preferences.incidentDurationSeconds) &&
        (preferences.incidentDurationSeconds as number) >= 5 &&
        (preferences.incidentDurationSeconds as number) <= 60 &&
        (
            preferences.forecastModelVariant === undefined ||
            ['rula', 'combined_strict'].includes(
                preferences.forecastModelVariant as string,
            )
        ) &&
        (
            preferences.alertConsecutivePredictions === undefined ||
            (
                Number.isInteger(preferences.alertConsecutivePredictions) &&
                (preferences.alertConsecutivePredictions as number) >= 1 &&
                (preferences.alertConsecutivePredictions as number) <= 5
            )
        ) &&
        (
            preferences.alertCooldownSeconds === undefined ||
            (
                Number.isInteger(preferences.alertCooldownSeconds) &&
                (preferences.alertCooldownSeconds as number) >= 30 &&
                (preferences.alertCooldownSeconds as number) <= 1800
            )
        )
    );
}

export async function getUserPreferences(
    userId: string,
): Promise<UserPreferences> {
    const cached = cache.get(userId);
    if (cached) return cached;
    const { rows } = await pool.query<{
        warning_rula_threshold: number;
        warning_cva_threshold: number;
        incident_duration_seconds: number;
        forecast_model_variant: ForecastModelVariant;
        alert_consecutive_predictions: number;
        alert_cooldown_seconds: number;
    }>(
        `SELECT warning_rula_threshold, warning_cva_threshold,
                incident_duration_seconds, forecast_model_variant,
                alert_consecutive_predictions, alert_cooldown_seconds
         FROM user_preferences
         WHERE user_id = $1`,
        [userId],
    );
    const row = rows[0];
    const preferences = row
        ? {
            warningRulaThreshold: row.warning_rula_threshold,
            warningCvaThreshold: row.warning_cva_threshold,
            incidentDurationSeconds: row.incident_duration_seconds,
            forecastModelVariant: row.forecast_model_variant,
            alertConsecutivePredictions: row.alert_consecutive_predictions,
            alertCooldownSeconds: row.alert_cooldown_seconds,
        }
        : DEFAULT_USER_PREFERENCES;
    cache.set(userId, preferences);
    return preferences;
}

export async function saveUserPreferences(
    userId: string,
    preferences: UserPreferences,
): Promise<UserPreferences> {
    const normalized = {
        ...DEFAULT_USER_PREFERENCES,
        ...preferences,
    };
    const { rows } = await pool.query<{
        warning_rula_threshold: number;
        warning_cva_threshold: number;
        incident_duration_seconds: number;
        forecast_model_variant: ForecastModelVariant;
        alert_consecutive_predictions: number;
        alert_cooldown_seconds: number;
    }>(
        `INSERT INTO user_preferences
            (user_id, warning_rula_threshold, warning_cva_threshold,
             incident_duration_seconds, forecast_model_variant,
             alert_consecutive_predictions, alert_cooldown_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET
             warning_rula_threshold = EXCLUDED.warning_rula_threshold,
             warning_cva_threshold = EXCLUDED.warning_cva_threshold,
             incident_duration_seconds = EXCLUDED.incident_duration_seconds,
             forecast_model_variant = EXCLUDED.forecast_model_variant,
             alert_consecutive_predictions = EXCLUDED.alert_consecutive_predictions,
             alert_cooldown_seconds = EXCLUDED.alert_cooldown_seconds,
             updated_at = CURRENT_TIMESTAMP
         RETURNING warning_rula_threshold, warning_cva_threshold,
                   incident_duration_seconds, forecast_model_variant,
                   alert_consecutive_predictions, alert_cooldown_seconds`,
        [
            userId,
            normalized.warningRulaThreshold,
            normalized.warningCvaThreshold,
            normalized.incidentDurationSeconds,
            normalized.forecastModelVariant,
            normalized.alertConsecutivePredictions,
            normalized.alertCooldownSeconds,
        ],
    );
    const saved = {
        warningRulaThreshold: rows[0].warning_rula_threshold,
        warningCvaThreshold: rows[0].warning_cva_threshold,
        incidentDurationSeconds: rows[0].incident_duration_seconds,
        forecastModelVariant: rows[0].forecast_model_variant,
        alertConsecutivePredictions: rows[0].alert_consecutive_predictions,
        alertCooldownSeconds: rows[0].alert_cooldown_seconds,
    };
    cache.set(userId, saved);
    return saved;
}

export async function getPrivacySettings(userId: string): Promise<PrivacySettings> {
    const cached = privacyCache.get(userId);
    if (cached) return cached;
    const { rows } = await pool.query<{
        personalization_consent: boolean;
        telemetry_training_opt_in: boolean;
        personalized_model_opt_in: boolean;
        consent_updated_at: Date | null;
    }>(
        `SELECT personalization_consent, telemetry_training_opt_in,
                personalized_model_opt_in, consent_updated_at
         FROM user_preferences
         WHERE user_id = $1`,
        [userId],
    );
    const privacy = rows[0]
        ? {
            personalizationConsent: rows[0].personalization_consent,
            telemetryTrainingOptIn: rows[0].telemetry_training_opt_in,
            personalizedModelOptIn: rows[0].personalized_model_opt_in,
            consentUpdatedAt: rows[0].consent_updated_at?.toISOString() ?? null,
        }
        : {
            personalizationConsent: false,
            telemetryTrainingOptIn: false,
            personalizedModelOptIn: false,
            consentUpdatedAt: null,
        };
    privacyCache.set(userId, privacy);
    return privacy;
}

export async function hasPersonalizationConsent(userId: string): Promise<boolean> {
    const privacy = await getPrivacySettings(userId);
    return privacy.telemetryTrainingOptIn && privacy.personalizedModelOptIn;
}

export async function hasTelemetryTrainingConsent(userId: string): Promise<boolean> {
    return (await getPrivacySettings(userId)).telemetryTrainingOptIn;
}

export async function saveTrainingConsent(
    userId: string,
    telemetryTrainingOptIn: boolean,
    personalizedModelOptIn: boolean,
): Promise<PrivacySettings> {
    const personalOptIn = telemetryTrainingOptIn && personalizedModelOptIn;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query<{
            personalization_consent: boolean;
            telemetry_training_opt_in: boolean;
            personalized_model_opt_in: boolean;
            consent_updated_at: Date;
        }>(
            `INSERT INTO user_preferences
                (user_id, personalization_consent, telemetry_training_opt_in,
                 personalized_model_opt_in, consent_updated_at)
             VALUES ($1, $2, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id) DO UPDATE SET
                 personalization_consent = EXCLUDED.personalization_consent,
                 telemetry_training_opt_in = EXCLUDED.telemetry_training_opt_in,
                 personalized_model_opt_in = EXCLUDED.personalized_model_opt_in,
                 consent_updated_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             RETURNING personalization_consent, telemetry_training_opt_in,
                       personalized_model_opt_in, consent_updated_at`,
            [userId, telemetryTrainingOptIn, personalOptIn],
        );
        await client.query(
            `INSERT INTO personalization_consent_audit
                (user_id, consented, telemetry_training_opt_in,
                 personalized_model_opt_in, source)
             VALUES ($1, $2, $2, $3, 'settings')`,
            [userId, telemetryTrainingOptIn, personalOptIn],
        );
        await client.query('COMMIT');
        const privacy = {
            personalizationConsent: rows[0].personalization_consent,
            telemetryTrainingOptIn: rows[0].telemetry_training_opt_in,
            personalizedModelOptIn: rows[0].personalized_model_opt_in,
            consentUpdatedAt: rows[0].consent_updated_at.toISOString(),
        };
        privacyCache.set(userId, privacy);
        return privacy;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function savePersonalizationConsent(
    userId: string,
    consented: boolean,
): Promise<PrivacySettings> {
    return saveTrainingConsent(userId, consented, consented);
}

export function clearUserPreferencesCache(): void {
    cache.clear();
    privacyCache.clear();
}
