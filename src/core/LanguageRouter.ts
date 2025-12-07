/**
 * LanguageRouter - Routes language requests to appropriate runtime managers
 */

import type { Language } from '../types/index.js';
import type { RuntimeManager } from '../runtimes/base/RuntimeManager.js';
import { logger } from '../utils/logger.js';

export class LanguageRouter {
  private runtimes = new Map<Language, RuntimeManager>();
  private log = logger.child({ component: 'LanguageRouter' });

  /**
   * Register a runtime manager for a language
   */
  public register(language: Language, runtime: RuntimeManager): void {
    if (this.runtimes.has(language)) {
      this.log.warn({ language }, 'Runtime already registered, overwriting');
    }

    this.runtimes.set(language, runtime);
    this.log.info({ language, image: runtime.defaultImage }, 'Runtime registered');
  }

  /**
   * Route to the appropriate runtime manager
   */
  public route(language: Language): RuntimeManager {
    const runtime = this.runtimes.get(language);

    if (!runtime) {
      throw new Error(`No runtime registered for language: ${language}`);
    }

    return runtime;
  }

  /**
   * Check if language is supported
   */
  public supports(language: Language): boolean {
    return this.runtimes.has(language);
  }

  /**
   * List all supported languages
   */
  public listLanguages(): Language[] {
    return Array.from(this.runtimes.keys());
  }

  /**
   * Get number of registered runtimes
   */
  public size(): number {
    return this.runtimes.size;
  }

  /**
   * Clear all registered runtimes
   */
  public clear(): void {
    this.runtimes.clear();
    this.log.info('All runtimes cleared');
  }
}

// Export singleton instance
export const languageRouter = new LanguageRouter();
