/**
 * Translate the dApp-internal command shape used by cantonCommands.ts
 *   { exercise: { templateId: { packageId, moduleName, entityName }, contractId, choice, choiceArgument } }
 *   { create:   { templateId: { packageId, moduleName, entityName }, createArguments } }
 * into the JSON Ledger API shape expected by the participant's
 * /v2/interactive-submission/prepare (and by the popup SDK's commandsJson, which
 * forwards straight to a participant):
 *   { ExerciseCommand: { templateId: "pkg:Module:Entity", contractId, choice, choiceArgument } }
 *   { CreateCommand:   { templateId: "pkg:Module:Entity", createArguments } }
 *
 * Already-normalized commands pass through unchanged.
 */
export function normalizeCommand(cmd: unknown): Record<string, unknown> {
  const c = cmd as Record<string, unknown>;

  if (c.exercise && typeof c.exercise === "object") {
    const ex = c.exercise as Record<string, unknown>;
    return {
      ExerciseCommand: {
        templateId: templateIdToString(ex.templateId),
        contractId: ex.contractId,
        choice: ex.choice,
        choiceArgument: ex.choiceArgument ?? ex.choice_argument,
      },
    };
  }

  if (c.create && typeof c.create === "object") {
    const cr = c.create as Record<string, unknown>;
    return {
      CreateCommand: {
        templateId: templateIdToString(cr.templateId),
        createArguments: cr.createArguments ?? cr.create_arguments ?? {},
      },
    };
  }

  return c;
}

export function normalizeCommands(commands: unknown): Record<string, unknown>[] {
  const arr = Array.isArray(commands) ? commands : commands ? [commands] : [];
  return arr.map(normalizeCommand);
}

function templateIdToString(tid: unknown): string {
  if (typeof tid === "string") return tid;
  if (tid && typeof tid === "object" && "packageId" in tid && "moduleName" in tid && "entityName" in tid) {
    const t = tid as Record<string, string>;
    return `${t.packageId}:${t.moduleName}:${t.entityName}`;
  }
  return "";
}
