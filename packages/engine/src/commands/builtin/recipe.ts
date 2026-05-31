import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import type { RecipeEngine } from '../../session/RecipeEngine.js';

let recipeEngineInstance: RecipeEngine | null = null;

export function setRecipeEngineInstance(engine: RecipeEngine): void {
  recipeEngineInstance = engine;
}

export function getRecipeEngineInstance(): RecipeEngine | null {
  return recipeEngineInstance;
}

export const recipeCommand: CommandInterface = {
  name: 'recipe',
  description: 'Run a recipe (automated multi-step workflow)',
  usage: '/recipe [<name>|list|export <name>|import <json>|create]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    if (!recipeEngineInstance) {
      context.emit('Recipe engine not available.');
      return { success: false, action: 'none' };
    }

    const sub = args[0];

    if (!sub || sub === 'list') {
      const tag = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
      const recipes = recipeEngineInstance.listRecipes(tag);
      if (recipes.length === 0) {
        context.emit('No recipes found. Add .json recipe files to ~/.config/agentx/recipes/');
        return { success: true, action: 'none' };
      }
      const lines = recipes.map((r) => `  ${r.name} — ${r.description} (${r.steps.length} steps)`);
      context.emit(`Recipes:\n${lines.join('\n')}`);
      return { success: true, action: 'none' };
    }

    if (sub === 'export') {
      const name = args[1];
      if (!name) {
        context.emit('Usage: /recipe export <name>');
        return { success: false, action: 'none' };
      }
      const recipe = recipeEngineInstance.exportRecipe(name);
      if (!recipe) {
        context.emit(`Recipe "${name}" not found.`);
        return { success: false, action: 'none' };
      }
      context.emit(JSON.stringify(recipe, null, 2));
      return { success: true, action: 'none', output: JSON.stringify(recipe) };
    }

    if (sub === 'import') {
      const json = args.slice(1).join(' ');
      if (!json) {
        context.emit('Usage: /recipe import <json-string>');
        return { success: false, action: 'none' };
      }
      try {
        const recipe = recipeEngineInstance.importRecipe(json);
        if (!recipe) {
          context.emit('Invalid recipe JSON. Must have "name" and "steps" fields.');
          return { success: false, action: 'none' };
        }
        context.emit(`✓ Imported recipe "${recipe.name}" (${recipe.steps.length} steps)`);
        return { success: true, action: 'none' };
      } catch (e) {
        context.emit(`Failed to import recipe: ${(e as Error).message}`);
        return { success: false, action: 'none' };
      }
    }

    if (sub === 'create') {
      const name = args[1] || 'untitled';
      const steps = args.slice(2).map((s) => ({ description: s, command: s }));
      const recipe = recipeEngineInstance.importRecipe(
        { id: '', name, description: `Recipe: ${name}`, version: '1.0', steps },
        `${name}.json`,
      );
      if (recipe) {
        context.emit(`✓ Created recipe "${recipe.name}" with ${recipe.steps.length} step(s)`);
      } else {
        context.emit('Failed to create recipe.');
      }
      return { success: !!recipe, action: 'none' };
    }

    // /recipe <name>
    const recipe = recipeEngineInstance.getRecipe(sub);
    if (!recipe) {
      context.emit(`Recipe "${sub}" not found.`);
      return { success: false, action: 'none' };
    }

    context.emit(`Running recipe "${recipe.name}" (${recipe.steps.length} steps)...`);
    const result = await recipeEngineInstance.executeRecipe(sub, async (step) => {
      context.emit(`  Step: ${step.description}`);
      if (step.recipe) {
        return `Executed sub-recipe: ${step.recipe}`;
      }
      if (step.command) {
        const { execSync } = await import('node:child_process');
        return execSync(step.command, { encoding: 'utf-8', timeout: 60000 });
      }
      return `Executed: ${step.description}`;
    });

    if (result.success) {
      context.emit(`Recipe "${sub}" completed successfully.`);
    } else {
      const failedStep = result.steps.find((s) => s.output.startsWith('ERROR:'));
      context.emit(`Recipe "${sub}" failed at step: ${failedStep?.step.description ?? 'unknown'}`);
    }
    return { success: result.success, action: 'none' };
  },
};
