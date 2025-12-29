/* eslint-disable no-console */
import assert from "assert";
import { ClickupApiImporter, ClickupImporterOptions } from "./ClickupApiImporter";

type MockResponseBody = any;

const makeResponse = (status: number, body: MockResponseBody) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return body;
  },
  async text() {
    return JSON.stringify(body);
  },
});

const run = async () => {
  await testSingleTaskImport();
  await testListImportWithLimit();
  console.info("All ClickupApiImporter tests passed.");
};

const testSingleTaskImport = async () => {
  const mockTask = {
    id: "task-1",
    name: "Fix login bug",
    description: "Steps to reproduce...",
    url: "https://app.clickup.com/task-1",
    status: { status: "triage" },
    assignees: [{ email: "dev@example.com", username: "dev" }],
    tags: [{ name: "bug", tag_bg: "#ff0000" }],
    priority: { priority: "urgent" },
    date_created: `${Date.now()}`,
    date_done: `${Date.now()}`,
  };

  const mockFetch = async (url: string) => {
    if (typeof url === "string" && url.includes("/task/task-1/comment")) {
      return makeResponse(200, {
        comments: [
          {
            id: "c1",
            comment_text: "First comment",
            date: `1000`,
            user: { email: "dev@example.com" },
          },
          {
            id: "c2",
            comment_text: "Second comment",
            date: `2000`,
            user: { email: "qa@example.com" },
          },
        ],
      });
    }
    if (typeof url === "string" && url.includes("/task/task-1")) {
      return makeResponse(200, mockTask);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const importer = new ClickupApiImporter(makeOptions({ singleTaskId: "task-1", fetchImpl: mockFetch }));
  const result = await importer.import();

  assert.equal(result.issues.length, 1, "should import one issue");
  const issue = result.issues[0];
  assert.equal(issue.title, "Fix login bug");
  assert.equal(issue.status, "Triage", "status mapping should apply");
  assert.equal(issue.priority, 1, "urgent maps to priority 1");
  assert.ok(issue.assigneeId?.includes("dev"), "assignee is mapped");
  assert.ok(issue.labels?.includes("bug"), "tag label included");
  assert.ok(issue.labels?.includes("BoardLabel"), "board label added");
  const description = issue.description ?? "";
  assert.ok(description.includes("ClickUp comments"), "comments header present");
  assert.ok(
    description.indexOf("First comment") < description.indexOf("Second comment"),
    "comments sorted chronologically"
  );
};

const testListImportWithLimit = async () => {
  const tasks = [
    { id: "a", name: "A", status: { status: "reviewed" }, priority: { priority: "normal" } },
    { id: "b", name: "B", status: { status: "fixed" }, priority: { priority: "low" } },
  ];

  const mockFetch = async (url: string) => {
    if (typeof url === "string" && url.includes("/list/123/task")) {
      return makeResponse(200, { tasks });
    }
    if (typeof url === "string" && url.includes("/comment")) {
      return makeResponse(200, { comments: [] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const importer = new ClickupApiImporter(
    makeOptions({
      listId: "123",
      maxIssues: 1,
      fetchImpl: mockFetch,
    })
  );
  const result = await importer.import();

  assert.equal(result.issues.length, 1, "respects maxIssues limit");
  assert.equal(result.issues[0].status, "Backlog", "reviewed maps to Backlog");
  assert.equal(result.issues[0].priority, 3, "normal maps to priority 3");
};

const makeOptions = (overrides: Partial<ClickupImporterOptions>): ClickupImporterOptions => ({
  apiToken: "token",
  listId: "list-1",
  labelForBoard: "BoardLabel",
  statusMapping: {
    triage: "Triage",
    reviewed: "Backlog",
    "up next": "Up Next",
    "in progress": "In Development",
    "fix in next release": "Done",
    fixed: "Released",
  },
  ...overrides,
});

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
