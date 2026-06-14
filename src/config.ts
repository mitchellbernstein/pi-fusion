import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FusionConfig, PanelMember, ResolvedPanelMember, PresetName } from "./types.js";

interface PresetDef {
  baseUrl: string;
  apiKeyEnv: string;
  openrouterHeaders?: boolean;
}

export const PRESETS: Record<PresetName, PresetDef> = {
  deepseek: { baseUrl: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY" },
  minimax: { baseUrl: "https://api.minimax.io/v1", apiKeyEnv: "MINIMAX_API_KEY" },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    openrouterHeaders: true,
  },
};

export const DEFAULT_PANEL: PanelMember[] = [
  { model: "deepseek-v4-pro", preset: "deepseek" },
  { model: "MiniMax-M3", preset: "minimax" },
  { model: "moonshotai/kimi-k2.7-code", preset: "openrouter" },
];

export const DEFAULT_JUDGE: PanelMember = { model: "deepseek-v4-pro", preset: "deepseek" };

export function resolveMember(member: PanelMember): ResolvedPanelMember {
  if (member.preset) {
    const preset = PRESETS[member.preset];
    if (!preset) throw new Error(`Unknown preset: ${member.preset}`);
    const apiKey = process.env[preset.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`Missing env var ${preset.apiKeyEnv} for preset ${member.preset}`);
    }
    return {
      model: member.model,
      baseUrl: preset.baseUrl,
      apiKey,
      openrouterHeaders: preset.openrouterHeaders,
    };
  }
  if (!member.baseUrl || !member.apiKeyEnv) {
    throw new Error(
      `Panel member "${member.model}" must have either "preset" or both "baseUrl" and "apiKeyEnv"`,
    );
  }
  const apiKey = process.env[member.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing env var ${member.apiKeyEnv} for model ${member.model}`);
  return {
    model: member.model,
    baseUrl: member.baseUrl,
    apiKey,
    openrouterHeaders: member.openrouterHeaders,
  };
}

const CONFIG_PATHS = [
  join(homedir(), ".pi", "fusion-panel.json"),
  join(homedir(), ".fusion-panel.json"),
];

export function loadConfig(configPath?: string): FusionConfig {
  if (configPath) {
    return JSON.parse(readFileSync(configPath, "utf-8")) as FusionConfig;
  }
  for (const p of CONFIG_PATHS) {
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as FusionConfig;
    } catch {
      // try next
    }
  }
  return { panel: DEFAULT_PANEL, judge: DEFAULT_JUDGE };
}

export function validateConfig(config: FusionConfig): void {
  if (config.panel.length < 3) {
    throw new Error(`Fusion requires at least 3 panel models, got ${config.panel.length}`);
  }
}
