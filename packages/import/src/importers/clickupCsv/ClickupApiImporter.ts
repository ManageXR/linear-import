import fetch from "node-fetch";
import { Importer, ImportResult, IssuePriority } from "../../types";

type ClickupPriority = "urgent" | "high" | "normal" | "low" | null;

interface ClickupTask {
  id: string;
  name: string;
  text_content?: string;
  description?: string;
  url?: string;
  status?: {
    status?: string;
    type?: string;
    color?: string;
  };
  assignees?: {
    id: number;
    username: string;
    email?: string;
    color?: string;
    initials?: string;
    name?: string;
    profilePicture?: string;
  }[];
  tags?: {
    name: string;
    tag_bg?: string;
    tag_fg?: string;
  }[];
  priority?: {
    color?: string;
    id?: string;
    orderindex?: string;
    priority: ClickupPriority;
  };
  date_created?: string;
  date_closed?: string;
  date_done?: string;
  due_date?: string;
}

interface ClickupTaskResponse {
  tasks: ClickupTask[];
}

export interface ClickupImporterOptions {
  listId: string;
  apiToken: string;
  apiBaseUrl?: string;
  labelForBoard?: string;
  statusMapping?: Record<string, string>;
  maxIssues?: number;
  singleTaskId?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Import issues from ClickUp via the API.
 */
export class ClickupApiImporter implements Importer {
  public constructor(options: ClickupImporterOptions) {
    this.listId = options.listId;
    this.apiToken = options.apiToken;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.clickup.com/api/v2";
    this.labelForBoard = options.labelForBoard;
    this.statusMapping = options.statusMapping ?? {};
    this.maxIssues = options.maxIssues ?? 1;
    this.singleTaskId = options.singleTaskId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public get name(): string {
    return "ClickUp (API)";
  }

  public get defaultTeamName(): string {
    return "ClickUp";
  }

  public import = async (): Promise<ImportResult> => {
    const importData: ImportResult = {
      issues: [],
      labels: {},
      users: {},
      statuses: {},
    };

    const tasks = await this.fetchTasks();
    for (const task of tasks) {
      const baseDescription = task.description || task.text_content || undefined;
      const originalUrl = task.url;
      const description =
        originalUrl && baseDescription
          ? `${baseDescription}\n\n[View original task in ClickUp](${originalUrl})`
          : originalUrl
            ? `[View original task in ClickUp](${originalUrl})`
            : baseDescription;
      const statusName = this.mapStatus(task.status?.status);
      const priority = this.mapPriority(task.priority?.priority);

      const labels: string[] = [];
      if (task.tags) {
        for (const tag of task.tags) {
          labels.push(tag.name);
          importData.labels[tag.name] = {
            name: tag.name,
            color: tag.tag_bg,
          };
        }
      }

      if (this.labelForBoard) {
        labels.push(this.labelForBoard);
        importData.labels[this.labelForBoard] = {
          name: this.labelForBoard,
        };
      }

      if (statusName && !importData.statuses?.[statusName]) {
        importData.statuses![statusName] = { name: statusName };
      }

      const assignee = task.assignees?.[0];
      if (assignee) {
        const assigneeKey = (assignee.email || assignee.username || "").toLowerCase();
        importData.users[assigneeKey] = {
          name: assignee.username || assignee.name || assigneeKey,
          email: assignee.email,
          avatarUrl: assignee.profilePicture,
        };
      }

      importData.issues.push({
        title: task.name,
        description,
        status: statusName,
        priority,
        url: originalUrl,
        assigneeId: assignee ? (assignee.email || assignee.username)?.toLowerCase() : undefined,
        labels,
        createdAt: this.toDate(task.date_created),
        completedAt: this.toDate(task.date_done || task.date_closed),
        dueDate: this.toDate(task.due_date),
      });
    }

    return importData;
  };

  private async fetchTasks(): Promise<ClickupTask[]> {
    if (this.singleTaskId) {
      const task = await this.fetchTaskById(this.singleTaskId);
      return task ? [task] : [];
    }

    const params = new URLSearchParams();
    params.set("include_closed", "true");
    params.set("page", "0");
    params.set("subtasks", "false");
    params.set("order_by", "created");
    params.set("reverse", "true");
    params.set("limit", String(this.maxIssues));

    const response = await this.fetchImpl(`${this.apiBaseUrl}/list/${this.listId}/task?${params.toString()}`, {
      headers: {
        Authorization: this.apiToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`ClickUp API error (${response.status}): ${message}`);
    }

    const data = (await response.json()) as ClickupTaskResponse;
    return data.tasks ?? [];
  }

  private async fetchTaskById(taskId: string): Promise<ClickupTask | undefined> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/task/${taskId}`, {
      headers: {
        Authorization: this.apiToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`ClickUp API error (${response.status}) when fetching task ${taskId}: ${message}`);
    }

    return (await response.json()) as ClickupTask;
  }

  private mapPriority(priority: ClickupPriority | undefined): IssuePriority | undefined {
    const priorityMap: Record<Exclude<ClickupPriority, null>, IssuePriority> = {
      urgent: 1,
      high: 2,
      normal: 3,
      low: 4,
    };
    if (!priority) {
      return undefined;
    }
    return priorityMap[priority] ?? undefined;
  }

  private mapStatus(status?: string): string | undefined {
    if (!status) {
      return undefined;
    }
    const normalized = status.toLowerCase();
    const mapped = this.statusMapping[normalized];
    return mapped ?? status;
  }

  private toDate(timestamp?: string): Date | undefined {
    if (!timestamp) {
      return undefined;
    }
    const num = parseInt(timestamp, 10);
    return Number.isNaN(num) ? undefined : new Date(num);
  }

  private listId: string;
  private apiToken: string;
  private apiBaseUrl: string;
  private labelForBoard?: string;
  private statusMapping: Record<string, string>;
  private maxIssues: number;
  private singleTaskId?: string;
  private fetchImpl: typeof fetch;
}
