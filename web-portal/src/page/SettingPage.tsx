import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearWebSession, getWebToken } from '../auth/webSession';
import { apiUrl } from '../config/env';

interface UserPreferences {
    warningRulaThreshold: number;
    warningCvaThreshold: number;
    incidentDurationSeconds: number;
    forecastModelVariant: 'rula' | 'combined_strict';
}

interface Personalization {
    status: string;
    sample_count: number;
    sequence_count: number;
    model_version: string | null;
    global_model_version: string | null;
    last_error: string | null;
}

interface ConsentSettings {
    telemetry_training_opt_in: boolean;
    personalized_model_opt_in: boolean;
    personalization: Personalization;
}

const DEFAULT_CONSENT: ConsentSettings = {
    telemetry_training_opt_in: false,
    personalized_model_opt_in: false,
    personalization: {
        status: 'not_started',
        sample_count: 0,
        sequence_count: 0,
        model_version: null,
        global_model_version: null,
        last_error: null,
    },
};

const DEFAULTS: UserPreferences = {
    warningRulaThreshold: 2,
    warningCvaThreshold: 50,
    incidentDurationSeconds: 15,
    forecastModelVariant: 'rula',
};

export default function SettingPage() {
    const navigate = useNavigate();
    const [preferences, setPreferences] = useState(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [consent, setConsent] = useState(DEFAULT_CONSENT);
    const [consentBusy, setConsentBusy] = useState(false);
    const [training, setTraining] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleUnauthorized = useCallback(() => {
        clearWebSession();
        navigate('/login', { replace: true });
    }, [navigate]);

    useEffect(() => {
        const controller = new AbortController();
        const token = getWebToken();
        if (!token) {
            handleUnauthorized();
            return controller.abort.bind(controller);
        }
        void fetch(apiUrl('/api/settings'), {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        })
            .then(async (response) => {
                if (response.status === 401) {
                    handleUnauthorized();
                    return null;
                }
                if (!response.ok) throw new Error('Preferences could not be loaded.');
                return response.json() as Promise<{
                    preferences?: Partial<UserPreferences> & Partial<ConsentSettings>;
                    telemetry_training_opt_in?: boolean;
                    personalized_model_opt_in?: boolean;
                    personalization?: Personalization;
                }>;
            })
            .then((body) => {
                if (body) {
                    if (body.preferences) {
                        setPreferences({
                            warningRulaThreshold:
                                body.preferences.warningRulaThreshold ??
                                DEFAULTS.warningRulaThreshold,
                            warningCvaThreshold:
                                body.preferences.warningCvaThreshold ??
                                DEFAULTS.warningCvaThreshold,
                            incidentDurationSeconds:
                                body.preferences.incidentDurationSeconds ??
                                DEFAULTS.incidentDurationSeconds,
                            forecastModelVariant:
                                body.preferences.forecastModelVariant === 'combined_strict'
                                    ? 'combined_strict'
                                    : DEFAULTS.forecastModelVariant,
                        });
                    }
                    const source = body.preferences ?? body;
                    setConsent({
                        telemetry_training_opt_in:
                            source.telemetry_training_opt_in ??
                            body.telemetry_training_opt_in ??
                            false,
                        personalized_model_opt_in:
                            source.personalized_model_opt_in ??
                            body.personalized_model_opt_in ??
                            false,
                        personalization:
                            source.personalization ??
                            body.personalization ??
                            DEFAULT_CONSENT.personalization,
                    });
                }
            })
            .catch((caught) => {
                if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
                    setError(caught instanceof Error ? caught.message : 'Preferences unavailable.');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [handleUnauthorized]);

    const save = async () => {
        const token = getWebToken();
        if (!token) {
            handleUnauthorized();
            return;
        }
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const response = await fetch(apiUrl('/api/settings'), {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(preferences),
            });
            if (response.status === 401) {
                handleUnauthorized();
                return;
            }
            const body = await response.json() as {
                preferences?: Partial<UserPreferences>;
                error?: string;
            };
            if (!response.ok || !body.preferences) {
                throw new Error(body.error ?? 'Preferences could not be saved.');
            }
            setPreferences((current) => ({
                warningRulaThreshold:
                    body.preferences?.warningRulaThreshold ??
                    current.warningRulaThreshold,
                warningCvaThreshold:
                    body.preferences?.warningCvaThreshold ??
                    current.warningCvaThreshold,
                incidentDurationSeconds:
                    body.preferences?.incidentDurationSeconds ??
                    current.incidentDurationSeconds,
                forecastModelVariant:
                    body.preferences?.forecastModelVariant === 'combined_strict'
                        ? 'combined_strict'
                        : body.preferences?.forecastModelVariant === 'rula'
                          ? 'rula'
                          : current.forecastModelVariant,
            }));
            setMessage('Preferences saved and applied to live telemetry.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Save failed.');
        } finally {
            setSaving(false);
        }
    };

    const authorizedRequest = async (path: string, init: RequestInit) => {
        const token = getWebToken();
        if (!token) {
            handleUnauthorized();
            throw new Error('Your session has expired.');
        }
        const response = await fetch(apiUrl(path), {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                ...init.headers,
            },
        });
        if (response.status === 401) {
            handleUnauthorized();
            throw new Error('Your session has expired.');
        }
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error ?? 'The request could not be completed.');
        }
        return response;
    };

    const updateConsent = async (next: Pick<
        ConsentSettings,
        'telemetry_training_opt_in' | 'personalized_model_opt_in'
    >) => {
        setConsentBusy(true);
        setError('');
        setMessage('');
        try {
            await authorizedRequest('/api/settings/consent', {
                method: 'PUT',
                body: JSON.stringify(next),
            });
            setConsent((current) => ({ ...current, ...next }));
            setMessage('Training choices saved.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Consent update failed.');
        } finally {
            setConsentBusy(false);
        }
    };

    const train = async () => {
        setTraining(true);
        setError('');
        setMessage('');
        try {
            const response = await authorizedRequest(
                '/api/settings/personalization/train',
                { method: 'POST' },
            );
            const body = await response.json().catch(() => ({})) as {
                personalization?: Personalization;
                status?: string;
            };
            setConsent((current) => ({
                ...current,
                personalization: body.personalization ?? {
                    ...current.personalization,
                    status: body.status ?? 'training',
                    last_error: null,
                },
            }));
            setMessage('Personal model training requested.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Training request failed.');
        } finally {
            setTraining(false);
        }
    };

    const refreshPersonalization = async () => {
        setError('');
        try {
            const response = await authorizedRequest(
                '/api/settings/personalization/status',
                { method: 'GET' },
            );
            const body = await response.json() as {
                personalization?: Personalization;
            };
            if (body.personalization) {
                setConsent((current) => ({
                    ...current,
                    personalization: body.personalization as Personalization,
                }));
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Status refresh failed.');
        }
    };

    const deleteTrainingData = async () => {
        if (!window.confirm(
            'Delete all telemetry saved for training and your personal model? This cannot be undone.',
        )) return;
        setDeleting(true);
        setError('');
        setMessage('');
        try {
            await authorizedRequest('/api/settings/training-data', { method: 'DELETE' });
            setConsent((current) => ({
                ...current,
                personalization: DEFAULT_CONSENT.personalization,
            }));
            setMessage('Training data and personal model deleted.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Delete failed.');
        } finally {
            setDeleting(false);
        }
    };

    if (loading) {
        return <div style={styles.message}>Loading posture preferences…</div>;
    }

    return (
        <main style={styles.container}>
            <header>
                <h2 style={styles.header}>Posture Preferences</h2>
                <p style={styles.subtitle}>
                    These values are stored with your account and applied by the
                    backend to live sensor assessments.
                </p>
            </header>

            {error && <div style={styles.error}>{error}</div>}
            {message && <div style={styles.success}>{message}</div>}

            <section style={styles.card}>
                <h3 style={styles.sectionTitle}>Warning sensitivity</h3>
                <label style={styles.label} htmlFor="rula-threshold">
                    Estimated RULA warning threshold
                    <strong style={styles.value}>
                        {preferences.warningRulaThreshold}
                    </strong>
                </label>
                <input
                    id="rula-threshold"
                    type="range"
                    min="2"
                    max="6"
                    value={preferences.warningRulaThreshold}
                    onChange={(event) => {
                        setMessage('');
                        setPreferences((current) => ({
                            ...current,
                            warningRulaThreshold: Number(event.target.value),
                        }));
                    }}
                    style={styles.slider}
                />
                <div style={styles.rangeLabels}>
                    <span>More sensitive</span>
                    <span>Less sensitive</span>
                </div>
                <p style={styles.hint}>
                    A frame at or above this estimated score starts a warning
                    episode. Critical status begins two score levels higher.
                </p>
            </section>

            <section style={styles.card}>
                <h3 style={styles.sectionTitle}>CVA warning sensitivity</h3>
                <label style={styles.label} htmlFor="cva-threshold">
                    Derived CVA warning threshold
                    <strong style={styles.value}>
                        {preferences.warningCvaThreshold}°
                    </strong>
                </label>
                <input
                    id="cva-threshold"
                    type="range"
                    min="20"
                    max="60"
                    value={preferences.warningCvaThreshold}
                    onChange={(event) => {
                        setMessage('');
                        setPreferences((current) => ({
                            ...current,
                            warningCvaThreshold: Number(event.target.value),
                        }));
                    }}
                    style={styles.slider}
                />
                <div style={styles.rangeLabels}>
                    <span>20° · lower is worse</span>
                    <span>60°</span>
                </div>
                <p style={styles.hint}>
                    A CVA-like angle at or below this value can contribute to a
                    warning. This angle is derived from calibrated IMU orientation
                    and is not a clinical measurement.
                </p>
            </section>

            <section style={styles.card}>
                <h3 style={styles.sectionTitle}>Incident duration</h3>
                <label style={styles.label} htmlFor="duration-threshold">
                    Minimum sustained duration
                    <strong style={styles.value}>
                        {preferences.incidentDurationSeconds} seconds
                    </strong>
                </label>
                <input
                    id="duration-threshold"
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={preferences.incidentDurationSeconds}
                    onChange={(event) => {
                        setMessage('');
                        setPreferences((current) => ({
                            ...current,
                            incidentDurationSeconds: Number(event.target.value),
                        }));
                    }}
                    style={styles.slider}
                />
                <p style={styles.hint}>
                    Shorter deviations are ignored. A completed warning or critical
                    episode is stored after posture returns to neutral.
                </p>
            </section>

            <section style={styles.card}>
                <h3 style={styles.sectionTitle}>Forecast target</h3>
                <label style={styles.optionRow}>
                    <input
                        type="radio"
                        name="forecast-model-variant"
                        value="rula"
                        checked={preferences.forecastModelVariant === 'rula'}
                        onChange={() => setPreferences((current) => ({
                            ...current,
                            forecastModelVariant: 'rula',
                        }))}
                    />
                    <span>
                        <strong>Estimated RULA risk</strong>
                        <small style={styles.toggleHelp}>
                            Forecasts whether the estimated RULA-based assessment
                            will become risky within the prediction horizon.
                        </small>
                    </span>
                </label>
                <label style={styles.optionRow}>
                    <input
                        type="radio"
                        name="forecast-model-variant"
                        value="combined_strict"
                        checked={preferences.forecastModelVariant === 'combined_strict'}
                        onChange={() => setPreferences((current) => ({
                            ...current,
                            forecastModelVariant: 'combined_strict',
                        }))}
                    />
                    <span>
                        <strong>Combined strict risk</strong>
                        <small style={styles.toggleHelp}>
                            Forecasts the stricter combined target: either estimated
                            RULA risk or a low derived CVA-like angle can mark a frame
                            as risky. This can warn more often.
                        </small>
                    </span>
                </label>
                <p style={styles.hint}>
                    This changes the forecast target, not the current posture status.
                    Derived CVA is an IMU-based approximation, not a clinical
                    measurement.
                </p>
            </section>

            <section style={styles.card}>
                <h3 style={styles.sectionTitle}>Improve posture predictions</h3>
                <label style={styles.toggleRow}>
                    <span>
                        <strong>Share movement features for model training</strong>
                        <small style={styles.toggleHelp}>
                            Allow calibrated angle and movement features to improve your
                            forecasts. Raw sensor quaternions are not saved for this
                            training feature. This is off until you enable it.
                        </small>
                    </span>
                    <input
                        type="checkbox"
                        checked={consent.telemetry_training_opt_in}
                        disabled={consentBusy}
                        onChange={(event) => void updateConsent({
                            telemetry_training_opt_in: event.target.checked,
                            personalized_model_opt_in:
                                event.target.checked &&
                                consent.personalized_model_opt_in,
                        })}
                    />
                </label>
                <label style={{
                    ...styles.toggleRow,
                    opacity: consent.telemetry_training_opt_in ? 1 : 0.55,
                }}>
                    <span>
                        <strong>Use a model trained for me</strong>
                        <small style={styles.toggleHelp}>
                            Train forecasts from your own telemetry. Sharing telemetry
                            must be enabled first, and the global forecast remains visible.
                        </small>
                    </span>
                    <input
                        type="checkbox"
                        checked={consent.personalized_model_opt_in}
                        disabled={!consent.telemetry_training_opt_in || consentBusy}
                        onChange={(event) => void updateConsent({
                            telemetry_training_opt_in:
                                consent.telemetry_training_opt_in,
                            personalized_model_opt_in: event.target.checked,
                        })}
                    />
                </label>

                <div style={styles.statusPanel}>
                    <div style={styles.statusHeader}>
                        <strong>Personal model</strong>
                        <span style={styles.statusBadge}>
                            {consent.personalization.status.replaceAll('_', ' ')}
                        </span>
                    </div>
                    <p style={styles.hint}>
                        Collected {consent.personalization.sample_count.toLocaleString()}
                        {' '}samples across{' '}
                        {consent.personalization.sequence_count.toLocaleString()} sequences.
                    </p>
                    <p style={styles.hint}>
                        Personal version: {consent.personalization.model_version ?? 'Not trained'}
                        {' · '}Global version:{' '}
                        {consent.personalization.global_model_version ?? 'Unavailable'}
                    </p>
                    {consent.personalization.last_error && (
                        <p style={styles.inlineError}>
                            Last training error: {consent.personalization.last_error}
                        </p>
                    )}
                    <div style={styles.actions}>
                        <button
                            type="button"
                            disabled={training || deleting}
                            onClick={() => void refreshPersonalization()}
                            style={styles.secondaryButton}
                        >
                            Refresh status
                        </button>
                        <button
                            type="button"
                            disabled={
                                !consent.telemetry_training_opt_in ||
                                !consent.personalized_model_opt_in ||
                                training
                            }
                            onClick={() => void train()}
                            style={styles.secondaryButton}
                        >
                            {training
                                ? 'Requesting…'
                                : consent.personalization.model_version
                                  ? 'Retrain personal model'
                                  : 'Train personal model'}
                        </button>
                        <button
                            type="button"
                            disabled={
                                deleting ||
                                (consent.personalization.sample_count === 0 &&
                                    !consent.personalization.model_version)
                            }
                            onClick={() => void deleteTrainingData()}
                            style={styles.dangerButton}
                        >
                            {deleting ? 'Deleting…' : 'Delete training data'}
                        </button>
                    </div>
                </div>
            </section>

            <aside style={styles.notice}>
                Notification routing has been removed from this page because push
                and email delivery are not implemented yet.
            </aside>

            <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                style={{
                    ...styles.saveButton,
                    opacity: saving ? 0.65 : 1,
                }}
            >
                {saving ? 'Saving…' : 'Save preferences'}
            </button>
        </main>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        maxWidth: '760px',
        margin: '0 auto',
        padding: '30px',
        color: '#f8fafc',
    },
    message: { padding: '30px', color: '#f8fafc' },
    header: { margin: 0, fontSize: '28px' },
    subtitle: { margin: '8px 0 26px', color: '#94a3b8', lineHeight: 1.5 },
    card: {
        marginBottom: '18px',
        padding: '24px',
        border: '1px solid #334155',
        borderRadius: '12px',
        backgroundColor: '#1e293b',
    },
    sectionTitle: {
        margin: '0 0 22px',
        paddingBottom: '10px',
        borderBottom: '1px solid #334155',
        color: '#38bdf8',
    },
    label: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '20px',
        fontWeight: 700,
    },
    value: { color: '#38bdf8' },
    slider: { width: '100%', marginTop: '18px', cursor: 'pointer' },
    rangeLabels: {
        display: 'flex',
        justifyContent: 'space-between',
        color: '#64748b',
        fontSize: '12px',
    },
    hint: { margin: '12px 0 0', color: '#94a3b8', fontSize: '13px', lineHeight: 1.5 },
    toggleRow: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '24px',
        padding: '14px 0',
        color: '#e2e8f0',
        cursor: 'pointer',
    },
    optionRow: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '12px 0',
        color: '#e2e8f0',
        cursor: 'pointer',
    },
    toggleHelp: {
        display: 'block',
        maxWidth: '580px',
        marginTop: '6px',
        color: '#94a3b8',
        fontWeight: 400,
        lineHeight: 1.5,
    },
    statusPanel: {
        marginTop: '12px',
        padding: '16px',
        border: '1px solid #475569',
        borderRadius: '9px',
        backgroundColor: '#0f172a',
    },
    statusHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
    },
    statusBadge: {
        padding: '4px 9px',
        borderRadius: '999px',
        color: '#c4b5fd',
        backgroundColor: '#4c1d95',
        fontSize: '12px',
        textTransform: 'capitalize',
    },
    inlineError: { margin: '10px 0 0', color: '#fca5a5', fontSize: '13px' },
    actions: { display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' },
    secondaryButton: {
        border: 0,
        borderRadius: '8px',
        padding: '10px 14px',
        color: '#1e1b4b',
        backgroundColor: '#a78bfa',
        cursor: 'pointer',
        fontWeight: 700,
    },
    dangerButton: {
        border: '1px solid #ef4444',
        borderRadius: '8px',
        padding: '10px 14px',
        color: '#fecaca',
        backgroundColor: '#450a0a',
        cursor: 'pointer',
        fontWeight: 700,
    },
    notice: {
        marginBottom: '18px',
        padding: '14px',
        border: '1px solid #475569',
        borderRadius: '9px',
        color: '#94a3b8',
        backgroundColor: '#0f172a',
        fontSize: '13px',
    },
    error: {
        marginBottom: '18px',
        padding: '12px',
        borderRadius: '8px',
        color: '#fecaca',
        backgroundColor: '#7f1d1d',
    },
    success: {
        marginBottom: '18px',
        padding: '12px',
        borderRadius: '8px',
        color: '#bbf7d0',
        backgroundColor: '#14532d',
    },
    saveButton: {
        width: '100%',
        border: 0,
        borderRadius: '8px',
        padding: '13px 20px',
        color: '#082f49',
        backgroundColor: '#38bdf8',
        cursor: 'pointer',
        fontSize: '16px',
        fontWeight: 700,
    },
};
