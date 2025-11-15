
import { ModelDefinition } from './types';

class Registry {
  private models: Map<string, ModelDefinition> = new Map();

  registerModel(model: ModelDefinition) {
    this.models.set(model.name, model);
  }

  getModel(name: string): ModelDefinition | undefined {
    return this.models.get(name);
  }

  hasModel(name: string): boolean {
    return this.models.has(name);
  }

  getAllModels(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  clear() {
    this.models.clear();
  }
}

// Export a singleton instance
export const modelRegistry = new Registry();
