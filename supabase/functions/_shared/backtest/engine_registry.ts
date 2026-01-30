// supabase/functions/_shared/backtest/engine_registry.ts
//
// Simple registry that maps engine version labels (e.g. "v4.6",
// "v4.7-alpha") to concrete EngineRunner implementations.

import type { EngineRunner } from "./engine_interface.ts";
import { v46EngineRunner } from "./v46/engine_adapter.ts";
import { v47EngineRunner } from "./v47/engine_adapter.ts";
import { v48EngineRunner } from "./v48/engine_adapter.ts";

const REGISTRY: Record<string, EngineRunner> = {
  "v4.6": v46EngineRunner,
  "v4.7-alpha": v47EngineRunner,
  "v4.8-alpha": v48EngineRunner,
};

export function getEngineRunner(engineVersion: string): EngineRunner {
  const runner = REGISTRY[engineVersion];
  if (!runner) {
    throw new Error(`[engine_registry] Unknown engine version: ${engineVersion}`);
  }
  return runner;
}

export function listRegisteredEngines(): string[] {
  return Object.keys(REGISTRY);
}
