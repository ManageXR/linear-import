import fetch from "node-fetch";
import { Importer, ImportResult, IssuePriority } from "../../types";
import type { Comment as LinearComment } from "../../types";

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

interface ClickupComment {
  id: string;
  comment_text?: string;
  date?: string;
  user?: {
    id?: number;
    username?: string;
    email?: string;
  };
}

interface ClickupCommentsResponse {
  comments: ClickupComment[];
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
  fetchImpl?: (url: string, init?: any) => Promise<any>;
  template?: "bug" | "none";
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
    this.fetchImpl = (options.fetchImpl ?? fetch) as (url: string, init?: any) => Promise<any>;
    this.template = options.template ?? "bug";
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

    const debug = process.env.CLICKUP_DEBUG === "true";
    let page = 0;
    const pageSize = Math.min(100, Math.max(1, this.maxIssues));
    const tasksBuffer: ClickupTask[] = [];

    while (importData.issues.length < this.maxIssues) {
      if (tasksBuffer.length === 0) {
        const pageTasks = await this.fetchTasks(page, pageSize);
        if (debug) {
          console.info(`[clickup] fetched page ${page} with ${pageTasks.length} tasks from list ${this.listId}`);
        }
        if (pageTasks.length === 0) {
          break;
        }
        tasksBuffer.push(...pageTasks);
        page += 1;
      }

      const task = tasksBuffer.shift();
      if (!task) break;

      const baseDescription = task.description || task.text_content || undefined;
      const originalUrl = task.url;
      const comments = await this.fetchComments(task.id);
      const rawStatus = task.status?.status?.toLowerCase();
      // Only import if the status exists in the provided mapping
      if (!rawStatus || !this.statusMapping[rawStatus]) {
        if (debug) {
          console.info(
            `[clickup] skipping task ${task.id} - status '${rawStatus ?? "undefined"}' not in mapping keys: ${Object.keys(
              this.statusMapping
            ).join(", ")}`
          );
        }
        continue;
      }
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

      const commentsBlock = this.formatComments(comments);
      const fullDescription = this.buildDescription({
        body: baseDescription,
        originalUrl,
        comments: commentsBlock,
        labels,
      });

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
        description: fullDescription,
        status: statusName,
        priority,
        url: originalUrl,
        assigneeId: assignee ? (assignee.email || assignee.username)?.toLowerCase() : undefined,
        labels,
        createdAt: this.toDate(task.date_created),
        completedAt: this.toDate(task.date_done || task.date_closed),
        dueDate: this.toDate(task.due_date),
      });

      if (importData.issues.length >= this.maxIssues) {
        break;
      }
    }

    if (debug) {
      console.info(`[clickup] imported ${importData.issues.length} issues after filtering`);
    }
    return importData;
  };

  private async fetchTasks(page: number, limit: number): Promise<ClickupTask[]> {
    if (this.singleTaskId) {
      const task = await this.fetchTaskById(this.singleTaskId);
      return task ? [task] : [];
    }

    const params = new URLSearchParams();
    params.set("include_closed", "true");
    params.set("page", String(page));
    params.set("subtasks", "false");
    params.set("order_by", "created");
    params.set("reverse", "true");
    params.set("limit", String(Math.min(100, Math.max(1, limit))));

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

  private async fetchComments(taskId: string): Promise<LinearComment[]> {
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}/task/${taskId}/comment`, {
        headers: {
          Authorization: this.apiToken,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as ClickupCommentsResponse;
      return (data.comments || []).map(comment => {
        const userKey = (comment.user?.email || comment.user?.username || "").toLowerCase();
        return {
          body: comment.comment_text,
          userId: userKey || "unknown",
          createdAt: this.toDate(comment.date),
        };
      });
    } catch {
      return [];
    }
  }

  private formatComments(comments: LinearComment[]): string | undefined {
    if (!comments.length) {
      return undefined;
    }
    const sorted = [...comments].sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt ? b.createdAt.getTime() : 0;
      return aTime - bTime;
    });
    const blocks = sorted.map(comment => {
      const date = comment.createdAt ? comment.createdAt.toISOString().split("T")[0] : "";
      return `**${comment.userId || "Unknown"}** ${date}\n\n${comment.body ?? ""}`;
    });
    return `### ClickUp comments\n\n${blocks.join("\n\n---\n\n")}`;
  }

  private buildDescription({
    body,
    originalUrl,
    comments,
    labels,
  }: {
    body?: string;
    originalUrl?: string;
    comments?: string;
    labels: string[];
  }): string | undefined {
    if (this.template === "bug") {
      return this.renderBugTemplate({ body, originalUrl, comments, labels });
    }

    const description =
      originalUrl && body
        ? `${body}\n\n[View original task in ClickUp](${originalUrl})`
        : originalUrl
          ? `[View original task in ClickUp](${originalUrl})`
          : body;
    return comments && description ? `${description}\n\n---\n\n${comments}` : comments || description;
  }

  private renderBugTemplate({
    body,
    originalUrl,
    comments,
    labels,
  }: {
    body?: string;
    originalUrl?: string;
    comments?: string;
    labels: string[];
  }): string {
    const sections = this.parseBodyIntoSections(body || "");

    const ctxLines: string[] = [];
    if (sections.context) ctxLines.push(sections.context);
    if (originalUrl) ctxLines.push(`Original ClickUp: ${originalUrl}`);
    if (labels.length) ctxLines.push(`Tags: ${labels.join(", ")}`);
    if (comments) ctxLines.push(comments);

    const renderSection = (title: string, content?: string) =>
      `# ${title}\n${content && content.trim().length ? content.trim() : ""}`.trimEnd();

    const parts = [
      renderSection("Loom / Screenshots / Logs", sections.looms),
      renderSection("Meta Workplace post (if n/a, leave blank)", sections.meta),
      renderSection("Steps to Reproduce:", sections.steps),
      renderSection("Actual Result:", sections.actual),
      renderSection("Expected Result:", sections.expected),
      renderSection("Known Workarounds (if any):", sections.workarounds),
      renderSection("Occurring in Production?", sections.production),
      renderSection("Context (if anything is n/a, leave blank)", ctxLines.join("\n\n")),
    ];

    return parts.join("\n\n\n");
  }

  private parseBodyIntoSections(body: string): {
    looms?: string;
    meta?: string;
    steps?: string;
    actual?: string;
    expected?: string;
    workarounds?: string;
    production?: string;
    context?: string;
  } {
    const buckets: Record<string, string[]> = {
      looms: [],
      meta: [],
      steps: [],
      actual: [],
      expected: [],
      workarounds: [],
      production: [],
      context: [],
    };

    const sectionMatchers: { key: keyof typeof buckets; regex: RegExp }[] = [
      { key: "looms", regex: /loom|screenshot|log|recording/i },
      { key: "steps", regex: /steps to reproduce|repro steps|steps/i },
      { key: "actual", regex: /actual result|observed/i },
      { key: "expected", regex: /expected result|expected/i },
      { key: "workarounds", regex: /workaround/i },
      { key: "production", regex: /production|prod\b/i },
      { key: "context", regex: /context|notes?/i },
    ];

    let current: keyof typeof buckets | null = null;
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (current) buckets[current].push("");
        continue;
      }

      const headingMatch = /^#{1,6}\s+(.*)/.exec(trimmed) || /^\*\*(.+?)\*\*\s*:?\s*$/.exec(trimmed);
      if (headingMatch) {
        const headingText = headingMatch[1];
        const matched = sectionMatchers.find(m => m.regex.test(headingText));
        if (matched) {
          current = matched.key;
          continue;
        }
      }

      const inlineMatch = sectionMatchers.find(m => m.regex.test(trimmed));
      if (inlineMatch) {
        current = inlineMatch.key;
        continue;
      }

      if (current) {
        buckets[current].push(trimmed);
      } else {
        buckets.context.push(trimmed);
      }
    }

    const toText = (arr: string[]) => arr.join("\n").trim() || undefined;
    return {
      looms: toText(buckets.looms),
      meta: toText(buckets.meta),
      steps: toText(buckets.steps),
      actual: toText(buckets.actual),
      expected: toText(buckets.expected),
      workarounds: toText(buckets.workarounds),
      production: toText(buckets.production),
      context: toText(buckets.context),
    };
  }

  private listId: string;
  private apiToken: string;
  private apiBaseUrl: string;
  private labelForBoard?: string;
  private statusMapping: Record<string, string>;
  private maxIssues: number;
  private singleTaskId?: string;
  private fetchImpl: (url: string, init?: any) => Promise<any>;
  private template: "bug" | "none";
}
