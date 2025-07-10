/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_MODEL = process.env.CI
  ? 'gemini-2.5-pro'
  : 'deepseek-ai/DeepSeek-V3';
export const DEFAULT_FLASH_MODEL = process.env.CI
  ? 'gemini-2.5-flash'
  : 'deepseek-ai/DeepSeek-V3';
export const DEFAULT_EMBEDDING_MODEL = process.env.CI
  ? 'gemini-embedding-001'
  : 'Qwen/Qwen3-Embedding-8B';

export const DEFAULT_GEMINI_MODEL = DEFAULT_MODEL;
export const DEFAULT_GEMINI_FLASH_MODEL = DEFAULT_FLASH_MODEL;
export const DEFAULT_GEMINI_EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL;
