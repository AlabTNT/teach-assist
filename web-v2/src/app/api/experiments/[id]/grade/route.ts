import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireStaff, requireTA, withAuth } from "@/lib/auth";
import { exec } from "child_process";
import util from "util";
import path from "path";
import fs from "fs";

const execAsync = util.promisify(exec);

function computeFinalScore(
  sub: {
    acceptanceScore: number | null;
    reportScore: number | null;
    codeScore: number | null;
    reportPenalty: number;
    codePenalty: number;
    checkpointClaimed: boolean;
  },
  exp: { acceptanceRatio: number; reportRatio: number; codeRatio: number },
): number | null {
  if (sub.checkpointClaimed) return 0;
  if (sub.acceptanceScore === null && sub.reportScore === null && sub.codeScore === null) return null;
  const raw =
    (sub.acceptanceScore ?? 0) * exp.acceptanceRatio +
    (sub.reportScore ?? 0) * exp.reportRatio +
    (sub.codeScore ?? 0) * exp.codeRatio;
  return Math.max(0, Math.round((raw - sub.reportPenalty - sub.codePenalty) * 10) / 10);
}

function computeZjuScores(
  sub: {
    acceptanceScore: number | null;
    reportScore: number | null;
    codeScore: number | null;
    reportPenalty: number;
    codePenalty: number;
    checkpointClaimed: boolean;
  },
  exp: { acceptanceRatio: number; reportRatio: number; codeRatio: number },
) {
  if (sub.checkpointClaimed) {
    return { codeAssignmentScore: 0, reportAssignmentScore: 0 };
  }

  // 1. 代码作业成绩：由现场验收与代码评分综合折算登录
  let codeAssignmentScore: number | null = null;
  if (sub.acceptanceScore !== null || sub.codeScore !== null) {
    const combinedWeight = exp.acceptanceRatio + exp.codeRatio;
    const raw =
      (sub.acceptanceScore ?? 0) * exp.acceptanceRatio +
      (sub.codeScore ?? 0) * exp.codeRatio;
    const normalized = combinedWeight > 0 ? (raw / combinedWeight) : raw;
    codeAssignmentScore = Math.max(0, Math.round((normalized - sub.codePenalty) * 10) / 10);
  }

  // 2. 报告作业成绩：由实验报告评分折算登录
  let reportAssignmentScore: number | null = null;
  if (sub.reportScore !== null) {
    reportAssignmentScore = Math.max(0, Math.round((sub.reportScore - sub.reportPenalty) * 10) / 10);
  }

  return { codeAssignmentScore, reportAssignmentScore };
}

export const GET = withAuth(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireStaff();
  const { id: experimentId } = await params;

  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: { questions: true },
  });
  if (!experiment) return Response.json({ error: "EXPERIMENT_NOT_FOUND" }, { status: 404 });

  const students = await prisma.user.findMany({
    where: { role: "STUDENT" },
    orderBy: { studentId: "asc" },
    include: { submissions: { where: { experimentId } } },
  });

  const roster = students.map((st) => {
    const sub = st.submissions[0] ?? null;
    const zjuScores = sub
      ? computeZjuScores(sub, experiment)
      : { codeAssignmentScore: null, reportAssignmentScore: null };

    return {
      id: st.id,
      studentId: st.studentId,
      name: st.name,
      hasCheckpoint: st.hasCheckpoint,
      submission: sub
        ? {
            id: sub.id,
            acceptanceScore: sub.acceptanceScore,
            reportScore: sub.reportScore,
            codeScore: sub.codeScore,
            reportPenalty: sub.reportPenalty,
            codePenalty: sub.codePenalty,
            isPlagiarised: sub.isPlagiarised,
            plagiarismGroup: sub.plagiarismGroup,
            checkpointClaimed: sub.checkpointClaimed,
            remark: sub.remark,
            submitTime: sub.submitTime,
            finalScore: computeFinalScore(sub, experiment),
            codeAssignmentScore: zjuScores.codeAssignmentScore,
            reportAssignmentScore: zjuScores.reportAssignmentScore,
          }
        : null,
    };
  });

  return Response.json({ experiment, roster });
});

const gradeSchema = z.object({
  action: z.literal("grade"),
  studentId: z.string().min(1),
  reportScore: z.union([z.number(), z.string(), z.null()]).optional(),
  codeScore: z.union([z.number(), z.string(), z.null()]).optional(),
  acceptanceScore: z.union([z.number(), z.string(), z.null()]).optional(),
  reportPenalty: z.coerce.number().optional(),
  codePenalty: z.coerce.number().optional(),
  isPlagiarised: z.boolean().optional(),
  plagiarismGroup: z.string().nullable().optional(),
  checkpointClaimed: z.boolean().optional(),
  remark: z.string().nullable().optional(),
});

const plagiarismSchema = z.object({ action: z.literal("check_plagiarism") });

const postSchema = z.discriminatedUnion("action", [gradeSchema, plagiarismSchema]);

export const POST = withAuth(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireTA();
  const { id: experimentId } = await params;
  const body = postSchema.parse(await request.json());

  if (body.action === "check_plagiarism") {
    const submissionsDir = path.join(process.cwd(), "../../data/submissions", experimentId);
    const simBin = process.env.SIM_BINARY ?? "/root/teach-assist/check/bin/sim_c++";

    if (
      !fs.existsSync(/* turbopackIgnore: true */ submissionsDir) ||
      !fs.existsSync(/* turbopackIgnore: true */ simBin)
    ) {
      return Response.json({ count: 0, note: "PLAGIARISM_ENV_MISSING" });
    }

    try {
      const { stdout } = await execAsync(`${simBin} -p ${submissionsDir}/**/*.cpp`);
      const flagged = new Set<string>();
      for (const line of stdout.split("\n")) {
        const match = line.match(/(\d+)\.cpp consists for (\d+) % of (\d+)\.cpp/);
        if (match && parseInt(match[2]) > 60) {
          flagged.add(match[1]);
          flagged.add(match[3]);
        }
      }
      for (const sId of flagged) {
        const user = await prisma.user.findFirst({ where: { studentId: sId } });
        if (user) {
          await prisma.submission.upsert({
            where: { studentId_experimentId: { studentId: user.id, experimentId } },
            update: { isPlagiarised: true, plagiarismGroup: "Similarity > 60%" },
            create: {
              studentId: user.id,
              experimentId,
              isPlagiarised: true,
              plagiarismGroup: "Similarity > 60%",
            },
          });
        }
      }
      return Response.json({ count: flagged.size });
    } catch (e) {
      console.error("sim check failed", e);
      return Response.json({ error: "PLAGIARISM_CHECK_FAILED" }, { status: 500 });
    }
  }

  // grade
  const student = await prisma.user.findFirst({
    where: { OR: [{ id: body.studentId }, { studentId: body.studentId }] },
  });
  if (!student) return Response.json({ error: "STUDENT_NOT_FOUND" }, { status: 404 });

  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === "" ? null : parseFloat(String(v));

  // Build partial update data only for keys that are provided in the payload
  const updateData: Record<string, any> = {};
  if ("reportScore" in body) updateData.reportScore = num(body.reportScore);
  if ("codeScore" in body) updateData.codeScore = num(body.codeScore);
  if ("acceptanceScore" in body) updateData.acceptanceScore = num(body.acceptanceScore);
  if (body.reportPenalty !== undefined) updateData.reportPenalty = body.reportPenalty;
  if (body.codePenalty !== undefined) updateData.codePenalty = body.codePenalty;
  if (body.isPlagiarised !== undefined) updateData.isPlagiarised = body.isPlagiarised;
  if ("plagiarismGroup" in body) updateData.plagiarismGroup = body.plagiarismGroup ?? null;
  if (body.checkpointClaimed !== undefined) updateData.checkpointClaimed = body.checkpointClaimed;
  if ("remark" in body) updateData.remark = body.remark ?? null;

  const createData = {
    studentId: student.id,
    experimentId,
    reportScore: "reportScore" in body ? num(body.reportScore) : null,
    codeScore: "codeScore" in body ? num(body.codeScore) : null,
    acceptanceScore: "acceptanceScore" in body ? num(body.acceptanceScore) : null,
    reportPenalty: body.reportPenalty ?? 0,
    codePenalty: body.codePenalty ?? 0,
    isPlagiarised: body.isPlagiarised ?? false,
    plagiarismGroup: body.plagiarismGroup ?? null,
    checkpointClaimed: body.checkpointClaimed ?? false,
    remark: body.remark ?? null,
  };

  const submission = await prisma.submission.upsert({
    where: { studentId_experimentId: { studentId: student.id, experimentId } },
    update: updateData,
    create: createData,
  });

  return Response.json({ submission });
});
