import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { chromium } from "@playwright/test";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import { R2_UNREVIEWED_CALIBRATION_CONTEXT, scoreR2JobFit } from "@applypilot/fit-scorer";
import {
  SourceCapabilityV2Schema,
  type SecureSourceTransportDependencies,
} from "@applypilot/job-sources";
import {
  BetaRepository,
  SourceEnablementRepository,
  R2ARepository,
  R2Repository,
  HostedWorkflowRepository,
  runGreenhouseSourceToQueue,
  runLeverSourceToQueue,
  runGreenhouseDetailToQueue,
  runLeverDetailToQueue,
} from "@applypilot/database";
import {
  ApplicationPacketSchema,
  HostedCapabilitySchema,
  HostedApplicationService,
  PlaywrightHostedApplicationDriver,
  HOSTED_ADAPTER_VERSION,
  PRIVATE_PREPARATION_VERIFICATION_POLICY,
  hostedDigest,
  hostedVerifiedFacts,
  reviewedHostedQuestions,
  packetDigest,
  greenhouseQuestions,
  type HostedHttpTransport,
  type HostedOwnerProof,
  type HostedSubject,
} from "@applypilot/application-runner";
import { testProfile } from "../fixture-data";

export const FICTIONAL_INSTANT = new Date("2026-10-09T05:00:00.000Z");
export const FICTIONAL_BUILD = {
  head: "a".repeat(40),
  tree: "b".repeat(40),
  buildDigest: "c".repeat(64),
  adapterVersion: HOSTED_ADAPTER_VERSION,
};
export const HOSTED_PRIVACY_CANARY = "FictionalHostedPrivateCanary";
export function fictionalHostedProof(action: string): HostedOwnerProof {
  return {
    action,
    consumedAt: FICTIONAL_INSTANT.toISOString(),
    nonceDigest: hostedDigest(randomUUID()),
    loopbackValidated: true,
    localSessionValidated: true,
    nonceConsumed: true,
    ownerConfirmed: true,
  };
}

/** Explicit FICTIONAL virtual HTTPS -> owned loopback HTTP bridge. Never passed to a REAL driver. */
export async function createHostedFixture(
  provider: "GREENHOUSE" | "LEVER" = "GREENHOUSE",
  options: {
    extraControls?: string;
    script?: string;
    remoteUpload?: boolean;
    postStatus?: number;
    confirmation?: boolean;
    lostResponse?: boolean;
    initialStatus?: number;
    formAction?: string;
    extraHeaders?: Record<string, string>;
    requireCookie?: boolean;
    firstNameAttributes?: string;
    formAttributes?: string;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "applypilot-hosted-"));
  const sqlite = new BetterSqlite3(join(root, "fictional.sqlite"));
  let closeSetup = async () => {
    sqlite.close();
    await removeFictionalRoot(root);
  };
  try {
    const migrations = fileURLToPath(new URL("../../packages/database/drizzle/", import.meta.url));
    for (const name of readdirSync(migrations)
      .filter((name) => /^\d{4}_.*\.sql$/.test(name))
      .sort())
      sqlite.exec(readFileSync(join(migrations, name), "utf8"));
    sqlite.pragma("foreign_keys=ON");
    const profile = CandidateProfileSchema.parse({
      ...testProfile,
      profileId: "profile:hosted-fictional",
      identity: {
        ...testProfile.identity,
        firstName: { ...testProfile.identity.firstName, value: HOSTED_PRIVACY_CANARY },
      },
    });
    const profileVersionId = "profile-version:hosted-fictional";
    const now = FICTIONAL_INSTANT.toISOString();
    sqlite
      .prepare(
        "INSERT INTO candidate_profiles(id,active_version_id,created_at,updated_at) VALUES(?,?,?,?)",
      )
      .run(profile.profileId, profileVersionId, now, now);
    sqlite
      .prepare(
        "INSERT INTO candidate_profile_versions(id,profile_id,version,schema_version,snapshot_json,content_hash,created_at) VALUES(?,?,1,1,?,?,?)",
      )
      .run(
        profileVersionId,
        profile.profileId,
        JSON.stringify(profile),
        candidateProfileContentHash(profile),
        now,
      );
    const host = provider === "GREENHOUSE" ? "boards.greenhouse.io" : "jobs.lever.co";
    const targetPath =
      provider === "GREENHOUSE" ? "/fictional/jobs/123" : "/fictional/post-123/apply";
    const externalId = provider === "GREENHOUSE" ? "123" : "post-123";
    const postPath = `${targetPath}/submit`;
    const uploadPath = `${targetPath}/upload`;
    const skills = [
      "Customer service",
      "Communication",
      "Teamwork",
      "Organisation",
      "Programming",
      "CAD",
      "Robotics",
    ];
    const html = `<h2>Role</h2><p>Part-time position in Melbourne VIC.</p><h2>Requirements</h2><ul>${skills.map((skill) => `<li>${skill} is required.</li>`).join("")}</ul>`;
    const greenhouseRecord = {
      id: 123,
      title: "Fictional Part-time Support Engineer",
      absolute_url: `https://${host}${targetPath}`,
      location: { name: "Melbourne VIC" },
      content: html,
      updated_at: now,
      metadata: null,
      departments: [],
      offices: [],
      questions: [
        {
          label: "First name",
          required: true,
          fields: [{ name: "first_name", type: "input_text" }],
        },
        { label: "Email", required: true, fields: [{ name: "email", type: "input_text" }] },
        {
          label: "Resume",
          required: true,
          fields: [
            { name: "resume", type: "input_file" },
            { name: "resume_text", type: "textarea" },
          ],
        },
      ],
    };
    const leverRecord = {
      id: externalId,
      text: "Fictional Part-time Support Engineer",
      hostedUrl: `https://${host}/fictional/${externalId}`,
      applyUrl: `https://${host}${targetPath}`,
      descriptionPlain: "Part-time position in Melbourne VIC. 16 hours per week.",
      categories: { location: "Melbourne VIC", commitment: "Part-time", department: "Engineering" },
      workplaceType: "on-site",
      country: "AU",
      lists: [
        {
          text: "Requirements",
          content: `<ul>${skills.map((skill) => `<li>${skill} is required.</li>`).join("")}</ul>`,
        },
      ],
      createdAt: FICTIONAL_INSTANT.getTime(),
    };
    const requests: { method: string; path: string }[] = [];
    let confirmedPosts = 0;
    let acknowledgedUploads = 0;
    let pdfDigest = "";
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      const body = Buffer.concat(chunks);
      const path = request.url ?? "/";
      requests.push({ method: request.method ?? "GET", path });
      if (path.startsWith("/provider/list")) {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify(
            provider === "GREENHOUSE"
              ? { jobs: [greenhouseRecord], meta: { total: 1 } }
              : [leverRecord],
          ),
        );
        return;
      }
      if (path.startsWith("/provider/detail")) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(provider === "GREENHOUSE" ? greenhouseRecord : leverRecord));
        return;
      }
      if (request.method === "POST") {
        try {
          if (
            options.requireCookie &&
            request.headers.cookie !== "fictional_csrf=fictional-cookie-canary"
          )
            throw new Error();
          const data = await new Response(new Uint8Array(body), {
            headers: { "content-type": request.headers["content-type"] ?? "" },
          }).formData();
          const file = data.get("resume");
          if (
            !(file instanceof File) ||
            createHash("sha256")
              .update(new Uint8Array(await file.arrayBuffer()))
              .digest("hex") !== pdfDigest
          )
            throw new Error();
          if (path === uploadPath) {
            acknowledgedUploads++;
            response.setHeader("content-type", "application/json");
            response.end(
              JSON.stringify({
                digest: pdfDigest,
                byteLength: file.size,
                acknowledgementId: "fictional-upload-ack",
              }),
            );
            return;
          }
          if (
            path !== postPath ||
            data.get("first_name") !== HOSTED_PRIVACY_CANARY ||
            data.get("email") !== profile.contact.email.value ||
            data.get("privacy") !== "on"
          )
            throw new Error();
          confirmedPosts++;
          response.statusCode = options.postStatus ?? 200;
          response.setHeader("content-type", "text/html");
          response.end(
            options.confirmation === false
              ? "<p>Unclear outcome</p>"
              : '<div id="application-confirmed">Application received</div>',
          );
          return;
        } catch {
          response.statusCode = 400;
          response.end("FICTIONAL_INPUT_REJECTED");
          return;
        }
      }
      if (path !== targetPath) {
        response.statusCode = 404;
        response.end("FICTIONAL_ROUTE_NOT_REVIEWED");
        return;
      }
      response.setHeader("content-type", "text/html");
      if (options.requireCookie)
        response.setHeader(
          "set-cookie",
          "fictional_csrf=fictional-cookie-canary; Secure; HttpOnly; SameSite=Strict; Path=/fictional/",
        );
      response.statusCode = options.initialStatus ?? 200;
      for (const [key, value] of Object.entries(options.extraHeaders ?? {}))
        response.setHeader(key, value);
      response.end(
        `<!doctype html><html><body><form action="${options.formAction ?? postPath}" method="POST" enctype="multipart/form-data" ${options.formAttributes ?? ""}><input type="hidden" name="csrf_token" value="fictional-token"><label for="first">First name</label><input id="first" name="first_name" required ${options.firstNameAttributes ?? ""}><label for="email">Email</label><input id="email" type="email" name="email" required><label for="resume">Resume</label><input id="resume" type="file" name="resume" accept=".pdf" required><label for="resume-text">Resume text</label><textarea id="resume-text" name="resume_text"></textarea><label for="privacy">I consent to the privacy policy</label><input id="privacy" type="checkbox" name="privacy" required>${options.extraControls ?? ""}<button type="submit">Apply</button></form>${options.remoteUpload ? `<script>document.getElementById('resume').addEventListener('change',async function(){const data=new FormData();data.append('resume',this.files[0]);await fetch('${uploadPath}',{method:'POST',body:data});});</script>` : ""}${options.script ? `<script>${options.script}</script>` : ""}</body></html>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    closeSetup = async () => {
      sqlite.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await removeFictionalRoot(root);
    };
    const transport: HostedHttpTransport = async (input) => {
      const response = await fetch(
        `http://127.0.0.1:${port}${input.url.pathname}${input.url.search}`,
        {
          method: input.method,
          body: input.body ? new Uint8Array(input.body) : undefined,
          headers: input.headers,
          redirect: "manual",
          signal: AbortSignal.timeout(input.timeoutMs),
        },
      );
      const body = Buffer.from(await response.arrayBuffer());
      if (input.method === "POST" && input.url.pathname === postPath && options.lostResponse)
        throw new Error("HOSTED_TRANSPORT_OUTCOME_UNKNOWN");
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };
    };
    const sourceDependencies: SecureSourceTransportDependencies = {
      resolveHost: async () => ["8.8.8.8"],
      request: async ({ url, pinnedAddress }) => {
        const response = await fetch(
          `http://127.0.0.1:${port}/provider/${url.pathname.endsWith(externalId) ? "detail" : "list"}${url.search}`,
          { redirect: "error", signal: AbortSignal.timeout(30_000) },
        );
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: new Uint8Array(await response.arrayBuffer()),
          connectedAddress: pinnedAddress,
        };
      },
    };
    const source = new SourceEnablementRepository(sqlite, () => FICTIONAL_INSTANT);
    const r2 = new R2Repository(sqlite, () => FICTIONAL_INSTANT);
    let evaluationNumber = 0;
    const evaluateJob = async (jobId: string) => {
      const version = sqlite
        .prepare("SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1")
        .get(jobId) as { id: string };
      const normalization = new R2ARepository(sqlite).getNormalization(version.id)!;
      const evaluationId = `evaluation:hosted:${++evaluationNumber}`;
      const eligibility = evaluateR2Eligibility({
        profile,
        normalization,
        bindings: {
          jobVersionId: version.id,
          currentJobVersionId: version.id,
          profileVersionId,
          currentProfileVersionId: profileVersionId,
          evidenceContractVersion: normalization.evidenceContractVersion,
          currentEvidenceContractVersion: normalization.evidenceContractVersion,
          evaluationVersionId: evaluationId,
        },
        evaluatedAt: now,
      });
      const fit = scoreR2JobFit({
        profile,
        normalization,
        eligibility,
        calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
      });
      r2.recordEvaluation({
        id: evaluationId,
        jobId,
        jobVersionId: version.id,
        profileVersionId,
        normalization,
        eligibility,
        fit,
      });
      sqlite
        .prepare(
          "INSERT INTO evaluation_versions(id,job_id,job_version_id,profile_version_id,evaluation_context,eligibility_status,eligibility_reasons_json,fit_score,fit_contributions_json,coverage_json,eligibility_engine_version,fit_engine_version,weight_version,stale,evaluated_at) VALUES(?,?,?,?,'PRIVATE_LOCAL_PROFILE',?,?,?,?,?,'2.2.0','2.2.0','r2-weights-1',0,?)",
        )
        .run(
          `legacy:${evaluationId}`,
          jobId,
          version.id,
          profileVersionId,
          eligibility.status,
          JSON.stringify(eligibility.reasons),
          fit.score,
          JSON.stringify(fit.contributions),
          JSON.stringify({ coveragePercent: fit.coveragePercent }),
          now,
        );
      return evaluationId;
    };
    const queueJob = (jobId: string, evaluationId: string) => {
      r2.recordQueueDecision({
        jobId,
        state: "REVIEWING",
        r2EvaluationId: evaluationId,
        duplicateResolutionVersion: r2.duplicateResolutionVersion(jobId),
        actor: "SYSTEM",
        reasonCode: "FICTIONAL_SOURCE_READY",
      });
    };
    const sourceCap = (operation: "LIST_JOBS" | "GET_JOB") =>
      SourceCapabilityV2Schema.parse({
        schemaVersion: 2,
        capabilityId: `source-hosted-${provider.toLowerCase()}-${operation.toLowerCase()}`,
        version: 1,
        predecessorVersion: null,
        source: provider,
        alias: "FICTIONAL hosted fixture",
        tenant: "fictional",
        region: "GLOBAL",
        allowedHost: provider === "GREENHOUSE" ? "boards-api.greenhouse.io" : "api.lever.co",
        allowedPathPrefix:
          provider === "GREENHOUSE" ? "/v1/boards/fictional/" : "/v0/postings/fictional",
        allowedOperations: [operation],
        approvalState: "APPROVED",
        approvalReference: "fictional-owner",
        approvedAt: now,
        policyVersion: "fictional-policy",
        policyReviewedAt: now,
        policyExpiresAt: "2026-10-10T05:00:00.000Z",
        capabilityExpiresAt: "2026-10-10T05:00:00.000Z",
        requestBudget: 1,
        recordCap: operation === "GET_JOB" ? 1 : 10,
        pageSizeCap: operation === "GET_JOB" ? 1 : 10,
        responseByteLimit: 1_000_000,
        requestTimeoutMs: 30_000,
        runTimeoutMs: 120_000,
        maxRedirects: 0,
        maxRetries: 0,
        maxConcurrency: 1,
        parserVersion: provider === "GREENHOUSE" ? "greenhouse-public-v2.1" : "lever-public-v2",
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
        revocationReason: null,
        requestBinding: {
          provider,
          region: "GLOBAL",
          tenant: "fictional",
          operation,
          externalId: operation === "GET_JOB" ? externalId : null,
          includeContent: provider === "GREENHOUSE" && operation === "LIST_JOBS",
          includeQuestions: provider === "GREENHOUSE" && operation === "GET_JOB",
          readerVersion: provider === "GREENHOUSE" ? "greenhouse-public-v2.1" : "lever-public-v2",
        },
      });
    for (const operation of ["LIST_JOBS", "GET_JOB"] as const) {
      const cap = sourceCap(operation);
      source.persistCapabilityVersion(cap);
      const gate = (action: "SOURCE_CAPABILITY_APPROVE" | "SOURCE_RUN_START") => ({
        action,
        consumedAt: now,
        loopbackValidated: true as const,
        localSessionValidated: true as const,
        nonceConsumed: true as const,
      });
      const receipts = source.createOwnerApprovalAndStartReceipt({
        capability: cap,
        operation,
        approvalGateProof: gate("SOURCE_CAPABILITY_APPROVE"),
        startGateProof: gate("SOURCE_RUN_START"),
        confirmationText: `APPROVE AND RUN ${cap.capabilityId}`,
        ownerConfirmed: true,
      });
      const input = {
        capability: cap,
        repository: source,
        ownerReceiptChain: receipts,
        dependencies: sourceDependencies,
        now: () => FICTIONAL_INSTANT,
        evaluateJob,
        queueJob,
      };
      const run =
        operation === "LIST_JOBS"
          ? provider === "GREENHOUSE"
            ? await runGreenhouseSourceToQueue(input)
            : await runLeverSourceToQueue(input)
          : provider === "GREENHOUSE"
            ? await runGreenhouseDetailToQueue({ ...input, externalId })
            : await runLeverDetailToQueue({ ...input, externalId });
      if (run.status !== "COMPLETE") throw new Error(`FICTIONAL_SOURCE_NOT_COMPLETE:${run.status}`);
    }
    const current = sqlite
      .prepare(
        "SELECT j.id AS jobId,v.id AS jobVersionId FROM jobs j JOIN job_versions v ON v.id=(SELECT id FROM job_versions WHERE job_id=j.id ORDER BY version DESC LIMIT 1) LIMIT 1",
      )
      .get() as { jobId: string; jobVersionId: string };
    const verification = new BetaRepository(
      sqlite,
      () => FICTIONAL_INSTANT,
    ).requireLatestQualifiedVerification(current.jobId, current.jobVersionId);
    const subject: HostedSubject = {
      ...current,
      profileVersionId,
      provider,
      region: "GLOBAL",
      tenant: "fictional",
      externalId,
      verificationId: verification.verificationId,
      sourceRunId: verification.runId,
      sourceContentHash: verification.contentHash,
      targetUrl: `https://${host}${targetPath}`,
    };
    const store = new HostedWorkflowRepository(sqlite, {
      mode: "FICTIONAL",
      approvedArtifactRoot: root,
      reviewedBuild: FICTIONAL_BUILD,
      now: () => FICTIONAL_INSTANT,
    });
    if (provider === "GREENHOUSE")
      store.recordDiscovery(subject, greenhouseQuestions(subject, greenhouseRecord));
    const passiveCap = HostedCapabilitySchema.parse({
      schemaVersion: 1,
      capabilityId: `hosted-${provider.toLowerCase()}-fictional`,
      version: 1,
      predecessorVersion: null,
      mode: "FICTIONAL",
      scriptPolicy: "NATIVE_SCRIPT_DISABLED",
      subject,
      scope: "PASSIVE_INSPECTION",
      packetId: null,
      packetDigest: null,
      formDigest: null,
      discoveryDigest: null,
      build: FICTIONAL_BUILD,
      policyReference: "fictional-native-policy",
      policyReviewedAt: now,
      expiresAt: "2026-10-09T06:00:00.000Z",
      createdAt: now,
      allowedReads: [{ origin: `https://${host}`, path: targetPath }],
      allowedWrites: [],
      confirmation: null,
      requestBudget: 10,
      responseByteLimit: 1_000_000,
      requestTimeoutMs: 30_000,
      sessionTimeoutMs: 3_600_000,
      remoteUploadProofRequired: false,
    });
    store.persistCapability(passiveCap);
    let driver: PlaywrightHostedApplicationDriver | null = null;
    const service = new HostedApplicationService({
      store,
      reviewedBuild: FICTIONAL_BUILD,
      now: () => FICTIONAL_INSTANT,
      driverFactory: (onRequest) =>
        (driver = new PlaywrightHostedApplicationDriver({
          transport,
          fictionalTransport: true,
          now: () => FICTIONAL_INSTANT,
          onRequest,
        })),
    });
    const preparePacket = async (sessionId: string) => {
      const session = store.getSession(sessionId);
      const discovery = session.discovery!;
      const browser = await chromium.launch({ headless: true });
      let bytes: Buffer;
      try {
        const page = await browser.newPage();
        await page.setContent(
          `<h1>Fictional CV</h1><p>${profile.identity.firstName.value} ${profile.identity.lastName.value}</p><p>${profile.contact.email.value}</p>`,
        );
        bytes = await page.pdf({ format: "A4" });
      } finally {
        await browser.close();
      }
      pdfDigest = createHash("sha256").update(bytes).digest("hex");
      const pdfPath = join(root, "fictional-cv.pdf");
      await writeFile(pdfPath, bytes);
      const documentId = randomUUID();
      sqlite
        .prepare(
          "INSERT INTO document_artifacts(id,job_id,job_version_id,profile_version_id,type,template,format,file_name,local_path,content_digest,claim_evidence_json,layout_result_json,version,stale,created_at) VALUES(?,?,?,?,'CV','basic','PDF','fictional-cv.pdf',?,?,'[]','{}',1,0,?)",
        )
        .run(
          documentId,
          subject.jobId,
          subject.jobVersionId,
          profileVersionId,
          pdfPath,
          pdfDigest,
          now,
        );
      sqlite
        .prepare(
          "INSERT INTO document_approvals(id,document_artifact_id,content_digest,approved_by,approved_at) VALUES(?,?,?,'LOCAL_USER',?)",
        )
        .run(randomUUID(), documentId, pdfDigest, now);
      const choiceReceipts = store.recordQuestionChoices(
        subject,
        discovery,
        [{ questionId: "form:privacy", value: true }],
        fictionalHostedProof(
          `HOSTED_QUESTION_REVIEW:${hostedDigest(subject)}:${hostedDigest(discovery)}`,
        ),
      );
      const questionReview = reviewedHostedQuestions({
        discovery,
        facts: hostedVerifiedFacts(profile),
        selections: discovery.groups.map((group) => ({
          groupId: group.id,
          alternative: group.id === "form:resume_text" ? null : 0,
        })),
        answers: discovery.questions.map((question) => ({
          questionId: question.id,
          factPath:
            question.controlName === "first_name"
              ? "identity.firstName"
              : question.controlName === "email"
                ? "contact.email"
                : null,
          ...(question.controlName === "privacy"
            ? { ownerChoice: { ...choiceReceipts.get(question.id)!, value: true } }
            : {}),
        })),
      });
      const evaluation = sqlite
        .prepare(
          "SELECT id,fit_score AS fitScore,recommended,eligibility_status AS eligibilityStatus FROM r2_evaluation_versions WHERE job_id=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(subject.jobId) as {
        id: string;
        fitScore: number;
        recommended: number;
        eligibilityStatus: string;
      };
      r2.recordQueueDecision({
        jobId: subject.jobId,
        state: "SHORTLISTED",
        r2EvaluationId: evaluation.id,
        duplicateResolutionVersion: r2.duplicateResolutionVersion(subject.jobId),
        actor: "OWNER",
        reasonCode: "FICTIONAL_OWNER_SHORTLISTED",
      });
      r2.recordQueueDecision({
        jobId: subject.jobId,
        state: "PREPARING",
        r2EvaluationId: evaluation.id,
        duplicateResolutionVersion: r2.duplicateResolutionVersion(subject.jobId),
        actor: "OWNER",
        reasonCode: "FICTIONAL_OWNER_PREPARING",
      });
      const packet = ApplicationPacketSchema.parse({
        id: randomUUID(),
        jobId: subject.jobId,
        jobVersionId: subject.jobVersionId,
        profileVersionId,
        evaluationVersionId: `legacy:${evaluation.id}`,
        r2EvaluationId: evaluation.id,
        eligibilityStatus: evaluation.eligibilityStatus,
        targetUrl: subject.targetUrl,
        targetHost: host,
        jobExpiryState: "UNKNOWN",
        duplicateState: "CLEAR",
        versionsCurrent: true,
        verificationEvidence: {
          verificationId: verification.verificationId,
          verifiedAt: verification.verifiedAt,
          providerExpiresAt: verification.providerExpiresAt,
          policyVersion: PRIVATE_PREPARATION_VERIFICATION_POLICY.version,
          preparationMaxAgeMs: PRIVATE_PREPARATION_VERIFICATION_POLICY.preparationMaxAgeMs,
          preExternalActionMaxAgeMs:
            PRIVATE_PREPARATION_VERIFICATION_POLICY.preExternalActionMaxAgeMs,
          validUntil: "2026-10-10T05:00:00.000Z",
          operation: "PREPARATION",
          contentHash: verification.contentHash,
        },
        documents: [
          {
            id: documentId,
            type: "CV",
            fileName: "fictional-cv.pdf",
            digest: pdfDigest,
            approved: true,
            stale: false,
            required: true,
          },
        ],
        ...questionReview,
      });
      const result = new BetaRepository(sqlite, () => FICTIONAL_INSTANT).persistApplicationPacket(
        packet,
      );
      const applicationCap = HostedCapabilitySchema.parse({
        ...passiveCap,
        version: 2,
        predecessorVersion: 1,
        scope: "APPLICATION",
        packetId: packet.id,
        packetDigest: packetDigest(packet),
        formDigest: hostedDigest(session.form),
        discoveryDigest: hostedDigest(discovery),
        allowedWrites: [
          {
            origin: `https://${host}`,
            path: postPath,
            operation: "SUBMIT",
            method: "POST",
            acknowledgement: "PROVIDER_CONFIRMATION",
          },
          ...(options.remoteUpload
            ? [
                {
                  origin: `https://${host}`,
                  path: uploadPath,
                  operation: "UPLOAD",
                  method: "POST",
                  acknowledgement: "SHA256_JSON_ACK",
                },
              ]
            : []),
        ],
        confirmation: {
          origin: `https://${host}`,
          path: postPath,
          selector: "#application-confirmed",
          expectedText: "Application received",
        },
        remoteUploadProofRequired: Boolean(options.remoteUpload),
      });
      store.persistCapability(applicationCap);
      return { packet, applicationCap, result, evaluation };
    };
    const close = async () => {
      await service.close();
      sqlite.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await removeFictionalRoot(root);
    };
    return {
      root,
      sqlite,
      profile,
      subject,
      passiveCap,
      store,
      service,
      transport,
      detailSourceCapability: sourceCap("GET_JOB"),
      mutateFictionalAttribute: async (selector: string, name: string, value: string) => {
        // Disposable fixture harness only: mutate the actual owned native DOM, never a real target.
        const owned = driver as unknown as { page: import("@playwright/test").Page | null };
        if (!owned?.page) throw new Error("FICTIONAL_CONTEXT_MISSING");
        const cdp = await owned.page.context().newCDPSession(owned.page);
        try {
          const document = await cdp.send("DOM.getDocument");
          const node = await cdp.send("DOM.querySelector", {
            nodeId: document.root.nodeId,
            selector,
          });
          await cdp.send("DOM.setAttributeValue", { nodeId: node.nodeId, name, value });
        } finally {
          await cdp.detach();
        }
      },
      requests,
      preparePacket,
      close,
      stats: () => ({ confirmedPosts, acknowledgedUploads }),
    };
  } catch (error) {
    await closeSetup();
    throw error;
  }
}
async function removeFictionalRoot(root: string) {
  const path = resolve(root);
  const rel = relative(resolve(tmpdir()), path);
  if (
    !basename(path).startsWith("applypilot-hosted-") ||
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  )
    throw new Error("FICTIONAL_CLEANUP_PATH_INVALID");
  await rm(path, { recursive: true, force: true });
}
