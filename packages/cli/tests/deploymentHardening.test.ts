import { describe, expect, it } from 'vitest';
import { buildBlueGreenPlan, createBlueGreenRollout } from '../lib/deploymentHardening.js';

describe('deployment hardening - blue/green', () => {
  it('builds a blue/green rollout plan with safeguards and pause conditions', () => {
    const plan = buildBlueGreenPlan({ trafficSteps: [20, 80, 100], latencyBudgetMs: 400, errorBudget: 0.05 });
    expect(plan.strategy).toBe('blue-green');
    expect(plan.phases).toContain('Health + smoke verification on candidate');
    expect(plan.safeguards.trafficSteps).toEqual([20, 80, 100]);
    expect(plan.pauseConditions.join(' ')).toMatch(/Error rate exceeds/i);
    expect(plan.rollbackPlan[0]).toMatch(/Freeze/);
  });

  it('pauses and suggests rollback when migrations fail', () => {
    const rollout = createBlueGreenRollout();
    rollout.apply({ type: 'migrationResult', ok: false, detail: 'syntax error' });
    const state = rollout.getState();
    expect(state.phase).toBe('paused');
    expect(state.rollbackSuggested).toBe(true);
    expect(state.pausedReason).toContain('Migration failed');
  });

  it('progresses through health checks, traffic steps, and completes on healthy signals', () => {
    const rollout = createBlueGreenRollout({ trafficSteps: [30, 100], latencyBudgetMs: 450, errorBudget: 0.05 });
    rollout.apply({ type: 'migrationResult', ok: true });
    rollout.apply({ type: 'health', ok: true, latencyMs: 300 });
    rollout.apply({ type: 'health', ok: true, latencyMs: 320 }); // warmup satisfied -> shift 30%
    expect(rollout.getState().trafficPercentToCandidate).toBe(30);
    rollout.apply({ type: 'health', ok: true, latencyMs: 330 }); // progress shift
    rollout.apply({ type: 'advanceTraffic' }); // move to 100%
    expect(rollout.getState().phase).toBe('monitoring');
    rollout.apply({ type: 'errorRate', value: 0.01 }); // healthy window
    const done = rollout.getState();
    expect(done.phase).toBe('completed');
    expect(done.paused).toBe(false);
  });

  it('auto-pauses on error budget breach during monitoring', () => {
    const rollout = createBlueGreenRollout({ trafficSteps: [50, 100], errorBudget: 0.02 });
    rollout.apply({ type: 'migrationResult', ok: true });
    rollout.apply({ type: 'health', ok: true, latencyMs: 200 });
    rollout.apply({ type: 'health', ok: true, latencyMs: 210 }); // start shifting
    rollout.apply({ type: 'advanceTraffic' });
    rollout.apply({ type: 'health', ok: true, latencyMs: 200 });
    rollout.apply({ type: 'advanceTraffic' }); // monitoring at 100%
    rollout.apply({ type: 'errorRate', value: 0.05 });
    const state = rollout.getState();
    expect(state.paused).toBe(true);
    expect(state.rollbackSuggested).toBe(true);
    expect(state.pausedReason).toContain('Error budget exceeded');
  });
});
