export type TrafficSlot = 'blue' | 'green';

export interface BlueGreenConfig {
  activeSlot: TrafficSlot;
  trafficSteps: number[];
  latencyBudgetMs: number;
  errorBudget: number; // acceptable error rate (0.02 = 2%)
  warmupHealthChecks: number; // number of consecutive healthy checks required before shift
}

export interface BlueGreenState {
  phase: 'migrating' | 'verifying' | 'shifting' | 'monitoring' | 'paused' | 'rolled-back' | 'completed';
  activeSlot: TrafficSlot;
  candidateSlot: TrafficSlot;
  trafficPercentToCandidate: number;
  paused: boolean;
  pausedReason?: string;
  rollbackSuggested: boolean;
}

export type BlueGreenEvent =
  | { type: 'migrationResult'; ok: boolean; detail?: string }
  | { type: 'health'; ok: boolean; latencyMs: number }
  | { type: 'errorRate'; value: number }
  | { type: 'advanceTraffic' }
  | { type: 'resume' }
  | { type: 'rollbackCompleted' };

export interface BlueGreenPlan {
  strategy: 'blue-green';
  phases: string[];
  safeguards: {
    latencyBudgetMs: number;
    errorBudget: number;
    trafficSteps: number[];
    warmupHealthChecks: number;
  };
  pauseConditions: string[];
  rollbackPlan: string[];
}

const DEFAULT_BLUEGREEN_CONFIG: BlueGreenConfig = {
  activeSlot: 'blue',
  trafficSteps: [10, 50, 100],
  latencyBudgetMs: 500,
  errorBudget: 0.02,
  warmupHealthChecks: 2,
};

export function buildBlueGreenPlan(config: Partial<BlueGreenConfig> = {}): BlueGreenPlan {
  const cfg = { ...DEFAULT_BLUEGREEN_CONFIG, ...config };
  const phases = [
    `Shadow migrate on candidate (${cfg.activeSlot === 'blue' ? 'green' : 'blue'})`,
    'Health + smoke verification on candidate',
    `Progressive traffic shift (${cfg.trafficSteps.join('%->')}%)`,
    'Error-budget / latency watch',
  ];

  return {
    strategy: 'blue-green',
    phases,
    safeguards: {
      latencyBudgetMs: cfg.latencyBudgetMs,
      errorBudget: cfg.errorBudget,
      trafficSteps: cfg.trafficSteps,
      warmupHealthChecks: cfg.warmupHealthChecks,
    },
    pauseConditions: [
      'Any migration failure on candidate slot',
      `Health check fails or latency > ${cfg.latencyBudgetMs}ms`,
      `Error rate exceeds ${cfg.errorBudget * 100}% during shift/monitoring`,
    ],
    rollbackPlan: [
      'Freeze further traffic shift',
      'Route 100% back to active slot',
      'Mark candidate as quarantined and require manual resume',
    ],
  };
}

export function createBlueGreenRollout(config: Partial<BlueGreenConfig> = {}) {
  const cfg: BlueGreenConfig = { ...DEFAULT_BLUEGREEN_CONFIG, ...config };
  const candidateSlot: TrafficSlot = cfg.activeSlot === 'blue' ? 'green' : 'blue';

  let state: BlueGreenState = {
    phase: 'migrating',
    activeSlot: cfg.activeSlot,
    candidateSlot,
    trafficPercentToCandidate: 0,
    paused: false,
    pausedReason: undefined,
    rollbackSuggested: false,
  };

  let consecutiveHealthy = 0;
  let trafficStepIndex = 0;

  const pause = (reason: string, suggestRollback = true) => {
    state = {
      ...state,
      phase: 'paused',
      paused: true,
      pausedReason: reason,
      rollbackSuggested: suggestRollback,
    };
  };

  const advanceTraffic = () => {
    if (trafficStepIndex < cfg.trafficSteps.length) {
      state = {
        ...state,
        trafficPercentToCandidate: cfg.trafficSteps[trafficStepIndex],
        phase: trafficStepIndex === cfg.trafficSteps.length - 1 ? 'monitoring' : 'shifting',
      };
      trafficStepIndex += 1;
    }
  };

  const apply = (event: BlueGreenEvent): BlueGreenState => {
    // If paused, only resume or rollback events are honored.
    if (state.paused) {
      if (event.type === 'resume') {
        state = { ...state, paused: false, pausedReason: undefined, rollbackSuggested: false, phase: 'monitoring' };
      } else if (event.type === 'rollbackCompleted') {
        state = { ...state, paused: false, phase: 'rolled-back', trafficPercentToCandidate: 0 };
      }
      return state;
    }

    switch (event.type) {
      case 'migrationResult': {
        if (!event.ok) {
          pause(`Migration failed: ${event.detail || 'unknown error'}`);
          break;
        }
        state = { ...state, phase: 'verifying' };
        break;
      }
      case 'health': {
        if (!event.ok || event.latencyMs > cfg.latencyBudgetMs) {
          pause(`Health check failed (latency ${event.latencyMs}ms)`, true);
          break;
        }
        consecutiveHealthy += 1;
        if (state.phase === 'verifying' && consecutiveHealthy >= cfg.warmupHealthChecks) {
          advanceTraffic();
        } else if (state.phase === 'shifting' && consecutiveHealthy >= cfg.warmupHealthChecks) {
          advanceTraffic();
        } else if (state.phase === 'monitoring' && trafficStepIndex === cfg.trafficSteps.length) {
          // already at 100% and healthy signals coming in
          state = { ...state, phase: 'completed' };
        }
        break;
      }
      case 'errorRate': {
        if (event.value > cfg.errorBudget) {
          pause(`Error budget exceeded (${(event.value * 100).toFixed(2)}%)`, true);
        } else if (
          state.phase === 'monitoring' &&
          state.trafficPercentToCandidate === cfg.trafficSteps[cfg.trafficSteps.length - 1]
        ) {
          state = { ...state, phase: 'completed' };
        }
        break;
      }
      case 'advanceTraffic': {
        advanceTraffic();
        break;
      }
      case 'rollbackCompleted': {
        state = { ...state, phase: 'rolled-back', trafficPercentToCandidate: 0 };
        break;
      }
      case 'resume': {
        state = { ...state, paused: false, pausedReason: undefined, rollbackSuggested: false };
        break;
      }
      default:
        break;
    }

    return state;
  };

  const getState = () => state;

  return { config: cfg, plan: buildBlueGreenPlan(cfg), apply, getState };
}
