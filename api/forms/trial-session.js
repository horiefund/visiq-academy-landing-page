const AIRTABLE_API_BASE = "https://api.airtable.com/v0";
const TABLE_NAME = "無料体験会申込";
const PARENT_MASTER_TABLE_NAME = "保護者・世帯マスター";
const PARENT_MASTER_LINK_FIELD_NAME = "保護者・世帯マスター";
const PARENT_MASTER_EMAIL_FIELD_NAME = "メールアドレス";
const PARENT_MASTER_NAME_FIELD_NAME = "保護者名";

const REQUIRED_FIELDS = ["保護者名", "メールアドレス", "お子さまの学年"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fs = require("fs");
const path = require("path");

let localEnvCache = null;

function readLocalEnvFallback() {
  if (localEnvCache) return localEnvCache;
  localEnvCache = {};
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(envPath)) return localEnvCache;
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      localEnvCache[key] = value;
    }
  } catch (_error) {
    // ignore fallback read failures
  }
  return localEnvCache;
}

function getEnvVar(name) {
  if (process.env[name] !== undefined) return process.env[name];
  const local = readLocalEnvFallback();
  return local[name];
}

function parseRequestBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (_error) {
      return {};
    }
  }
  return body;
}

function sendDebugLog(payload) {
  fetch("http://127.0.0.1:7881/ingest/9b823623-6f9d-4db7-af30-e1c69cc1c6c1", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "34ca24" },
    body: JSON.stringify({
      sessionId: "34ca24",
      timestamp: Date.now(),
      ...payload,
    }),
  }).catch(() => {});
}

async function airtableCreateRecord({ baseId, apiKey, tableName, fields }) {
  const url = `${AIRTABLE_API_BASE}/${baseId}/${encodeURIComponent(tableName)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      typecast: true,
      records: [{ fields }],
    }),
  });

  const data = await response.json().catch(() => null);
  return { ok: response.ok, data };
}

function escapeAirtableFormulaString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function airtableFindRecordsByEmail({ baseId, apiKey, tableName, emailFieldName, email }) {
  const filter = `{${emailFieldName}}='${escapeAirtableFormulaString(email)}'`;
  const params = new URLSearchParams({
    filterByFormula: filter,
    maxRecords: "1",
  });
  const url = `${AIRTABLE_API_BASE}/${baseId}/${encodeURIComponent(tableName)}?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, data };
}

async function resolveParentMasterRecordId({ baseId, apiKey, fields }) {
  const email = fields[PARENT_MASTER_EMAIL_FIELD_NAME];
  sendDebugLog({
    runId: "run-ts-3",
    hypothesisId: "H7",
    location: "api/forms/trial-session.js:resolveParentMasterRecordId",
    message: "Resolving parent master link by email",
    data: { hasEmail: Boolean(email) },
  });

  const findResult = await airtableFindRecordsByEmail({
    baseId,
    apiKey,
    tableName: PARENT_MASTER_TABLE_NAME,
    emailFieldName: PARENT_MASTER_EMAIL_FIELD_NAME,
    email,
  });

  if (!findResult.ok) {
    const error = new Error(findResult.data?.error?.message || "Failed to find parent master record");
    error.statusCode = 502;
    error.stage = "parent-master-find";
    throw error;
  }

  const records = findResult.data?.records || [];
  const existingRecordId = records[0]?.id;
  if (existingRecordId) {
    sendDebugLog({
      runId: "run-ts-3",
      hypothesisId: "H7",
      location: "api/forms/trial-session.js:resolveParentMasterRecordId:matched",
      message: "Matched existing parent master record",
      data: { parentMasterRecordId: existingRecordId, matchedCount: records.length },
    });
    sendDebugLog({
      runId: "run-ts-3",
      hypothesisId: "H9",
      location: "api/forms/trial-session.js:resolveParentMasterRecordId:duplicatePolicy",
      message: "Applied duplicate email policy with maxRecords=1 (first record adopted)",
      data: { email, selectedRecordId: existingRecordId },
    });
    return existingRecordId;
  }

  const parentMasterFields = {
    [PARENT_MASTER_EMAIL_FIELD_NAME]: email,
  };
  if (typeof fields[PARENT_MASTER_NAME_FIELD_NAME] === "string" && fields[PARENT_MASTER_NAME_FIELD_NAME].trim() !== "") {
    parentMasterFields[PARENT_MASTER_NAME_FIELD_NAME] = fields[PARENT_MASTER_NAME_FIELD_NAME].trim();
  }

  sendDebugLog({
    runId: "run-ts-3",
    hypothesisId: "H7",
    location: "api/forms/trial-session.js:resolveParentMasterRecordId:create",
    message: "No parent master match, creating new record",
    data: { createFieldKeys: Object.keys(parentMasterFields) },
  });

  const createResult = await airtableCreateRecord({
    baseId,
    apiKey,
    tableName: PARENT_MASTER_TABLE_NAME,
    fields: parentMasterFields,
  });

  if (!createResult.ok) {
    const error = new Error(createResult.data?.error?.message || "Failed to create parent master record");
    error.statusCode = 502;
    error.stage = "parent-master-create";
    throw error;
  }

  const createdRecordId = createResult.data?.records?.[0]?.id;
  if (!createdRecordId) {
    const error = new Error("Parent master record id not returned");
    error.statusCode = 502;
    error.stage = "parent-master-create";
    throw error;
  }

  sendDebugLog({
    runId: "run-ts-3",
    hypothesisId: "H7",
    location: "api/forms/trial-session.js:resolveParentMasterRecordId:created",
    message: "Created new parent master record",
    data: { parentMasterRecordId: createdRecordId },
  });

  return createdRecordId;
}

function validateFields(fields) {
  return REQUIRED_FIELDS.every((name) => typeof fields[name] === "string" && fields[name].trim() !== "");
}

function normalizeFields(rawFields) {
  const fields = { ...(rawFields || {}) };
  if (fields["お子さまの学年"] === undefined && fields["お子様の学年"] !== undefined) {
    fields["お子さまの学年"] = fields["お子様の学年"];
    delete fields["お子様の学年"];
  }
  if (fields["お子さま人数"] === undefined && fields["お子様数"] !== undefined) {
    fields["お子さま人数"] = fields["お子様数"];
    delete fields["お子様数"];
  }
  return fields;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const { airtableRecord } = parseRequestBody(req.body);
    const requestTableName = airtableRecord?.tableName;
    const fields = normalizeFields(airtableRecord?.fields ?? {});

    if (!validateFields(fields)) {
      return res.status(400).json({ ok: false, message: "Missing required fields" });
    }
    if (!EMAIL_PATTERN.test(fields["メールアドレス"])) {
      return res.status(400).json({ ok: false, message: "Invalid email address" });
    }
    if (requestTableName && requestTableName !== TABLE_NAME) {
      return res.status(400).json({ ok: false, message: "Invalid table name" });
    }

    const baseId = getEnvVar("AIRTABLE_BASE_ID");
    const apiKey = getEnvVar("AIRTABLE_API_KEY");
    const enableAirtableRaw = getEnvVar("ENABLE_AIRTABLE_FORM_SAVE");
    const enableAirtable = enableAirtableRaw === "true";
    sendDebugLog({
      runId: "run-ts-2",
      hypothesisId: "H6",
      location: "api/forms/trial-session.js:envCheck",
      message: "Resolved environment flags for Airtable save",
      data: {
        enableAirtableRaw: enableAirtableRaw ?? null,
        enableAirtable,
        hasBaseId: Boolean(baseId),
        hasApiKey: Boolean(apiKey),
      },
    });

    if (!enableAirtable) {
      return res.status(200).json({ ok: true, mode: "mock", received: { tableName: TABLE_NAME, fields } });
    }
    if (!baseId || !apiKey) {
      return res.status(500).json({ ok: false, message: "Airtable credentials are not configured" });
    }

    const parentMasterRecordId = await resolveParentMasterRecordId({ baseId, apiKey, fields });
    fields[PARENT_MASTER_LINK_FIELD_NAME] = [parentMasterRecordId];
    sendDebugLog({
      runId: "run-ts-3",
      hypothesisId: "H8",
      location: "api/forms/trial-session.js:beforeCreate",
      message: "Prepared fields before trial-session create",
      data: {
        linkFieldName: PARENT_MASTER_LINK_FIELD_NAME,
        linkFieldValue: fields[PARENT_MASTER_LINK_FIELD_NAME],
        fieldKeys: Object.keys(fields || {}),
      },
    });

    const result = await airtableCreateRecord({ baseId, apiKey, tableName: TABLE_NAME, fields });
    sendDebugLog({
      runId: "run-ts-1",
      hypothesisId: "H3",
      location: "api/forms/trial-session.js:airtableCreateRecord",
      message: "Airtable response received",
      data: {
        ok: result.ok,
        errorType: result?.data?.error?.type || null,
        errorMessage: result?.data?.error?.message || null,
        recordId: result?.data?.records?.[0]?.id || null,
        returnedLinkField: result?.data?.records?.[0]?.fields?.[PARENT_MASTER_LINK_FIELD_NAME] || null,
      },
    });

    if (!result.ok) {
      return res.status(502).json({ ok: false, message: result.data?.error?.message || "Airtable request failed" });
    }

    return res.status(200).json({
      ok: true,
      mode: "airtable",
      recordId: result.data?.records?.[0]?.id ?? null,
    });
  } catch (error) {
    sendDebugLog({
      runId: "run-ts-1",
      hypothesisId: "H5",
      location: "api/forms/trial-session.js:catch",
      message: "Unhandled exception in API route",
      data: {
        errorMessage: String(error?.message || error),
        errorName: error?.name || null,
        errorStage: error?.stage || null,
      },
    });
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      ok: false,
      message: statusCode === 500 ? "Unexpected server error" : String(error?.message || "Request failed"),
      stage: error?.stage || null,
      ...(process.env.NODE_ENV !== "production" ? { detail: String(error?.message || error) } : {}),
    });
  }
}

module.exports = handler;
module.exports.default = handler;
