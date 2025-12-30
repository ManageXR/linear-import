import * as inquirer from "inquirer";
import { Importer } from "../../types";
import { ClickupApiImporter, ClickupImporterOptions } from "./ClickupApiImporter";

export const clickupImport = async (): Promise<Importer> => {
  const answers = await inquirer.prompt<ClickupImportAnswers>(questions);

  const statusMapping =
    answers.statusMapping && answers.statusMapping.trim().length > 0 ? parseStatusMapping(answers.statusMapping) : {};

  const importerOptions: ClickupImporterOptions = {
    apiToken: answers.clickupApiToken,
    listId: answers.clickupListId,
    apiBaseUrl: answers.clickupApiBaseUrl,
    labelForBoard: answers.boardLabel || undefined,
    statusMapping,
    maxIssues: answers.maxIssues ?? 1,
    singleTaskId: answers.singleTaskId || undefined,
    template: answers.templateChoice,
  };

  return new ClickupApiImporter(importerOptions);
};

interface ClickupImportAnswers {
  clickupApiToken: string;
  clickupApiBaseUrl?: string;
  clickupListId: string;
  boardLabel?: string;
  statusMapping: string;
  maxIssues?: number;
  singleTaskId?: string;
  templateChoice: "bug" | "product" | "none";
}

const questions = [
  {
    type: "password",
    name: "clickupApiToken",
    message: "Input your ClickUp API token",
    mask: "*",
    validate: (input: string) => input && input.length > 0,
  },
  {
    type: "input",
    name: "clickupApiBaseUrl",
    message: "ClickUp API base URL (press enter for default https://api.clickup.com/api/v2):",
    default: "https://api.clickup.com/api/v2",
  },
  {
    type: "input",
    name: "clickupListId",
    message: "ClickUp list ID for your board:",
    validate: (input: string) => input && input.length > 0,
  },
  {
    type: "input",
    name: "singleTaskId",
    message: "Optional: import only a single ClickUp task ID (for testing):",
  },
  {
    type: "number",
    name: "maxIssues",
    message: "Max issues to import (ignored if single task ID provided):",
    default: 1,
  },
  {
    type: "input",
    name: "boardLabel",
    message: "Linear label to add for this board (optional):",
  },
  {
    type: "input",
    name: "statusMapping",
    message:
      'Optional status mapping (JSON, e.g. {"todo":"Backlog","in progress":"Started"}). Leave blank to use ClickUp statuses as-is:',
    default:
      '{"ready":"Ready","up next":"Up Next","Development":"In Development","code review":"In Code Review","qa":"QA","done":"Done"}',
  },
  // {"up next":"Up Next","in progress":"In Development","fix in next release":"Done"}
  // {"ready":"Ready:,"up next":"Up Next","Development":"In Development","code review":"Code Review","qa":"QA","done":"Done"}
  // '{"ready":"Ready","up next":"Up Next","Development":"In Development","code review":"In Code Review","qa":"QA","done":"Done"}',

  {
    type: "list",
    name: "templateChoice",
    message: "Select description template:",
    choices: [
      { name: "Bug", value: "bug" },
      { name: "Product", value: "product" },
      { name: "None (raw body + link + comments)", value: "none" },
    ],
    default: "bug",
  },
];

const parseStatusMapping = (raw: string): Record<string, string> => {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      throw new Error("Mapping must be a JSON object");
    }
    const normalized: Record<string, string> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (typeof value === "string") {
        normalized[key.toLowerCase()] = value;
      }
    });
    return normalized;
  } catch (error) {
    throw new Error(`Invalid status mapping JSON: ${(error as Error).message}`);
  }
};
