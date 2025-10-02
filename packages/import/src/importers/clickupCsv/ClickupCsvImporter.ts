import csv from "csvtojson";
import { Importer, ImportResult } from "../../types";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const j2m = require("jira2md");

/**
 * Import issues from a ClickUp CSV export.
 *
 * @param filePath  path to csv file
 * @param orgSlug   base ClickUp organization url
 */
export class ClickupCsvImporter implements Importer {
  public constructor(filePath: string, orgSlug: string) {
    this.filePath = filePath;
    this.organizationName = orgSlug;
  }

  public get name(): string {
    return "ClickUp (CSV)";
  }

  public get defaultTeamName(): string {
    return "ClickUp";
  }

  public import = async (): Promise<ImportResult> => {
    // TODO: Implement import logic
    const importData: ImportResult = {
      issues: [],
      labels: {},
      users: {},
      statuses: {},
    };

    return importData;
  };

  // -- Private interface

  private filePath: string;
  private organizationName?: string;
}
