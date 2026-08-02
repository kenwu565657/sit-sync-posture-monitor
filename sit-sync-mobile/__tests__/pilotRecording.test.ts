import {
  createPilotSequenceId,
  getPilotRecordingStatus,
  pilotRecordingWarning,
  startPilotRecording,
  stopPilotRecording,
} from '../src/recording/pilotRecording';

describe('pilot recording API', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  it('creates stable filename-safe sequence IDs', () => {
    expect(createPilotSequenceId(new Date('2026-07-19T14:03:04.123Z'))).toBe(
      'pilot_self_20260719140304',
    );
  });

  it('starts a test-only self pilot recording', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'recording',
          filePath: '/recordings/pilot_self_1.csv',
          databaseSessionId: 'database-session-1',
        }),
        {status: 201},
      ),
    );

    const status = await startPilotRecording(
      'http://localhost:8787/',
      'user-token',
      'mobile-1',
      'pilot_self_1',
    );

    expect(status).toEqual({
      recording: true,
      mountingMode: 'shoulder_top',
      frames: 0,
      sequenceId: 'pilot_self_1',
      durationSeconds: 0,
      filePath: '/recordings/pilot_self_1.csv',
      writeErrors: 0,
      databaseSessionId: 'database-session-1',
      databaseStatus: 'recording',
      databasePersistedFrames: 0,
      databaseWriteErrors: 0,
    });
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://localhost:8787/api/recording/start');
    expect(init.headers.Authorization).toBe('Bearer user-token');
    expect(JSON.parse(init.body)).toMatchObject({
      device_id: 'mobile-1',
      participant_id: 'self_pilot',
      action_id: 'natural_desk_30min',
      split: 'test',
      mounting_mode: 'shoulder_top',
    });
  });

  it('loads status and stops the active recording', async () => {
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({recording: true, frames: 25}), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'stopped',
            frames: 30,
            persistedFrames: 30,
            durationSeconds: 6,
            effectiveSampleHz: 5,
            writeErrors: 0,
            databaseSessionId: 'database-session-1',
            databaseStatus: 'completed',
            databasePersistedFrames: 30,
            databaseWriteErrors: 0,
            filePath: '/recordings/pilot.csv',
          }),
          {status: 200},
        ),
      );

    await expect(
      getPilotRecordingStatus(
        'http://localhost:8787',
        'user-token',
        'mobile/a',
      ),
    ).resolves.toMatchObject({recording: true, frames: 25});
    await expect(
      stopPilotRecording(
        'http://localhost:8787',
        'user-token',
        'mobile/a',
      ),
    ).resolves.toMatchObject({status: 'stopped', frames: 30});
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain(
      'mobile%2Fa',
    );
  });

  it('warns when a recording starts without frames or falls below 10 Hz', () => {
    expect(
      pilotRecordingWarning({
        recording: true,
        frames: 0,
        durationSeconds: 10,
      }),
    ).toContain('no server frames');
    expect(
      pilotRecordingWarning({
        recording: true,
        frames: 60,
        durationSeconds: 10,
        effectiveSampleHz: 6,
      }),
    ).toContain('below 8.5 Hz');
    expect(
      pilotRecordingWarning({
        recording: true,
        frames: 100,
        durationSeconds: 10,
        effectiveSampleHz: 10,
      }),
    ).toBeNull();
    expect(
      pilotRecordingWarning({
        recording: true,
        databaseStatus: 'failed',
        lastDatabaseWriteError: 'database unavailable',
      }),
    ).toBe('database unavailable');
  });
});
