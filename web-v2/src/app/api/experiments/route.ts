import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireStaff, withAuth, type SessionUser } from "@/lib/auth";

export const GET = withAuth(async () => {
  const experiments = await prisma.experiment.findMany({
    orderBy: { number: "asc" },
    include: { _count: { select: { submissions: true } }, questions: true },
  });
  return Response.json({ experiments });
});

const createSchema = z.object({
  number: z.coerce.string().min(1),
  name: z.string().min(1),
  publishDate: z.string().min(1),
  dueDate: z.string().min(1),
  totalScore: z.coerce.number().default(100),
  courseWeight: z.coerce.number().default(0),
  acceptanceRatio: z.coerce.number().default(0.5),
  reportRatio: z.coerce.number().default(0.2),
  codeRatio: z.coerce.number().default(0.3),
  type: z.enum(["HARDWARE", "SOFTWARE", "INTEGRATED"]).default("HARDWARE"),
  isPublished: z.boolean().optional(),
  questions: z.array(z.string().min(1)).default([]),
});

export const POST = withAuth(async (request: Request) => {
  await requireStaff();
  const body = createSchema.parse(await request.json());

  const experiment = await prisma.experiment.create({
    data: {
      number: body.number,
      name: body.name,
      publishDate: new Date(body.publishDate),
      dueDate: new Date(body.dueDate),
      totalScore: body.totalScore,
      courseWeight: body.courseWeight,
      acceptanceRatio: body.acceptanceRatio,
      reportRatio: body.reportRatio,
      codeRatio: body.codeRatio,
      type: body.type === "INTEGRATED" ? "BOTH" : body.type,
      isPublished: body.isPublished ?? false,
      questions:
        body.questions.length > 0
          ? { create: body.questions.map((content) => ({ content })) }
          : undefined,
    },
    include: { questions: true },
  });

  return Response.json({ experiment });
});

async function syncToZju(session: SessionUser, experiment: { id: string }) {
  try {
    const { ZJUAM } = await import("@/lib/zju/zjuam");
    const { ZJUCourses, TARGET_COURSE_ID } = await import("@/lib/zju/zju_courses");

    // 1. Try session user first, then fallback to any configured TA with ZJUAM credentials
    let taUser = await prisma.user.findUnique({ where: { id: session.id } });
    if (!taUser?.zjuamAccount || !taUser?.zjuamPassword) {
      taUser = await prisma.user.findFirst({
        where: {
          role: "TA",
          zjuamAccount: { not: null },
          zjuamPassword: { not: null },
        },
      });
    }

    if (!taUser?.zjuamAccount || !taUser?.zjuamPassword) {
      return {
        skipped: true,
        error: "NO_ZJUAM_CREDENTIALS",
        message: "未找到已配置学在浙大/ZJUAM认证信息的助教账号，跳过在线作业创建",
      };
    }

    const am = new ZJUAM(taUser.zjuamAccount, taUser.zjuamPassword);
    await am.login();
    const cookies = await am.loginService("https://courses.zju.edu.cn/user/index");
    const courses = new ZJUCourses(cookies);
    const full = await prisma.experiment.findUnique({ where: { id: experiment.id } });
    if (!full) return { error: "EXPERIMENT_NOT_FOUND" };

    const dual = await courses.createExperimentDualHomeworks(TARGET_COURSE_ID, full, true);
    return { success: true, dual };
  } catch (err) {
    console.warn("ZJU sync failed:", err);
    return {
      error: err instanceof Error ? err.message : "SYNC_FAILED",
      message: err instanceof Error ? err.message : "同步学在浙大失败",
    };
  }
}

const patchSchema = z.object({
  id: z.string().min(1),
  isPublished: z.boolean(),
  syncZju: z.boolean().default(true),
});

export const PATCH = withAuth(async (request: Request) => {
  const session = await requireStaff();
  const { id, isPublished, syncZju } = patchSchema.parse(await request.json());

  const experiment = await prisma.experiment.update({
    where: { id },
    data: { isPublished },
  });

  const syncResult = syncZju && isPublished ? await syncToZju(session, experiment) : null;

  return Response.json({ experiment, syncResult });
});

