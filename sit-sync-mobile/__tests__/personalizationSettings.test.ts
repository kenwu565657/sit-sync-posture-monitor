import {
  deleteTrainingData,
  loadTrainingSettings,
  savePosturePreferences,
  saveTrainingConsent,
  trainPersonalModel,
} from '../src/settings/personalization';

describe('personalization settings API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads consent and personalization status with the user token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        preferences: {
          warningRulaThreshold: 3,
          warningCvaThreshold: 48,
          incidentDurationSeconds: 20,
        },
        telemetry_training_opt_in: true,
        personalized_model_opt_in: true,
        personalization: {
          status: 'ready',
          sample_count: 120,
          sequence_count: 4,
          model_version: 'personal-2',
          global_model_version: 'global-7',
          last_error: null,
        },
      }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });

    await expect(
      loadTrainingSettings('https://api.example.com/', 'jwt'),
    ).resolves.toEqual(
      expect.objectContaining({
        telemetry_training_opt_in: true,
        preferences: expect.objectContaining({ warningCvaThreshold: 48 }),
        personalization: expect.objectContaining({ sample_count: 120 }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/settings?mounting_mode=shoulder_top',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt' }),
      }),
    );
  });

  it('sends posture, consent, training, and delete requests to their endpoints', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });

    await savePosturePreferences('https://api.example.com', 'jwt', {
      warningRulaThreshold: 3,
      warningCvaThreshold: 47,
      incidentDurationSeconds: 20,
    });
    await saveTrainingConsent('https://api.example.com', 'jwt', {
      telemetry_training_opt_in: true,
      personalized_model_opt_in: false,
    });
    await trainPersonalModel('https://api.example.com', 'jwt');
    await deleteTrainingData('https://api.example.com', 'jwt');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/api/settings',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          warningRulaThreshold: 3,
          warningCvaThreshold: 47,
          incidentDurationSeconds: 20,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/api/settings/consent',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.example.com/api/settings/personalization/train',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://api.example.com/api/settings/training-data',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
