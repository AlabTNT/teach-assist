"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Button, Chip, Skeleton, Spinner } from "@heroui/react";
import useSWR from "swr";
import { toast } from "sonner";
import { fetcher } from "@/lib/api-hooks";
import { Icon } from "@/components/ui/Icon";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { cn } from "@/lib/utils";

type Experiment = { id: string; number: string; name: string };

type RosterEntry = {
  id: string;
  studentId: string;
  name: string;
  hasCheckpoint: boolean;
  submission: {
    acceptanceScore: number | null;
    reportScore: number | null;
    codeScore: number | null;
    reportPenalty: number;
    codePenalty: number;
    isPlagiarised: boolean;
    checkpointClaimed: boolean;
    remark: string | null;
    finalScore: number | null;
    codeAssignmentScore: number | null;
    reportAssignmentScore: number | null;
  } | null;
};

const cellInput =
  "tabular w-16 rounded-lg border border-line bg-sunken px-2 py-1.5 text-center text-sm outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15";

function ScoreCell({
  value,
  onSave,
  placeholder = "—",
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState<string>(value?.toString() ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setEditing(value?.toString() ?? "");
    setDirty(false);
  }, [value]);

  const commit = async () => {
    if (!dirty) return;
    const v = editing.trim() === "" ? null : Math.min(100, Math.max(0, parseFloat(editing)));
    if (v !== null && Number.isNaN(v)) return;
    await onSave(v);
    setDirty(false);
  };

  return (
    <input
      className={cn(cellInput, dirty && "border-amber-500 ring-2 ring-amber-500/20")}
      value={editing}
      placeholder={placeholder}
      onChange={(e) => {
        setEditing(e.target.value);
        setDirty(true);
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export default function AssignmentsPage() {
  const t = useTranslations("assignments");
  const tc = useTranslations("common");
  const [expId, setExpId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [checkingPlagiarism, setCheckingPlagiarism] = useState(false);
  const [syncingZju, setSyncingZju] = useState(false);

  const { data: expData } = useSWR<{ experiments: (Experiment & { isPublished: boolean })[] }>(
    "/api/experiments",
    fetcher,
  );

  useEffect(() => {
    if (!expId && expData?.experiments.length) {
      setExpId(expData.experiments.find((e) => e.isPublished)?.id ?? expData.experiments[0].id);
    }
  }, [expData, expId]);

  const { data, isLoading, mutate } = useSWR<{ roster: RosterEntry[] }>(
    expId ? `/api/experiments/${expId}/grade` : null,
    fetcher,
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const query = q.trim().toLowerCase();
    if (!query) return data.roster;
    return data.roster.filter(
      (r) => r.studentId.toLowerCase().includes(query) || r.studentId.endsWith(query) || r.name.includes(q.trim()),
    );
  }, [data, q]);

  const saveScore = async (studentId: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/experiments/${expId}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "grade", studentId, ...patch }),
    });
    if (res.ok) mutate();
    else toast.error(tc("error"));
  };

  const runPlagiarism = async () => {
    setCheckingPlagiarism(true);
    try {
      const res = await fetch(`/api/experiments/${expId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_plagiarism" }),
      });
      const d = await res.json();
      toast.info(`${t("runPlagiarism")}: ${d.count ?? 0}`);
      mutate();
    } finally {
      setCheckingPlagiarism(false);
    }
  };

  const syncZjuHomeworks = async () => {
    if (!expId) return;
    setSyncingZju(true);
    try {
      const res = await fetch("/api/experiments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: expId, isPublished: true, syncZju: true }),
      });
      const d = await res.json();
      if (res.ok) {
        if (d.syncResult?.success) {
          toast.success("学在浙大双作业同步创建成功！");
        } else if (d.syncResult?.skipped) {
          toast.info("未配置学在浙大助教凭据，请先在设置页保存账号");
        } else {
          toast.error(`同步失败: ${d.syncResult?.message || d.syncResult?.error || tc("error")}`);
        }
      } else {
        toast.error(tc("error"));
      }
    } catch {
      toast.error(tc("error"));
    } finally {
      setSyncingZju(false);
    }
  };

  const exportZjuCsv = () => {
    if (!data?.roster || !expData) return;
    const currentExp = expData.experiments.find((e) => e.id === expId);
    const expName = currentExp ? currentExp.number : "Experiment";

    const headers = [
      "学号",
      "姓名",
      "现场验收(100分制)",
      "代码评分(100分制)",
      "代码作业登分(验收+代码折算)",
      "报告评分(100分制)",
      "报告作业登分(报告折算)",
      "罚分",
      "最终总评分",
      "备注",
    ];

    const rows = data.roster.map((r) => [
      `\t${r.studentId}`,
      r.name,
      r.submission?.acceptanceScore ?? "",
      r.submission?.codeScore ?? "",
      r.submission?.codeAssignmentScore ?? "",
      r.submission?.reportScore ?? "",
      r.submission?.reportAssignmentScore ?? "",
      (r.submission?.reportPenalty ?? 0) + (r.submission?.codePenalty ?? 0),
      r.submission?.finalScore ?? "",
      r.submission?.remark ?? (r.hasCheckpoint ? "Checkpoint" : ""),
    ]);

    const csvContent =
      "\uFEFF" +
      [
        headers.join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
        ),
      ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${expName}_学在浙大登分表.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已导出学在浙大登分表 (CSV)");
  };

  return (
    <div className="mx-auto max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mb-6 flex flex-wrap items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t("title")}</h1>
          <p className="mt-1 text-xs text-fg-muted">
            录入现场验收、报告与代码评分，自动计算学在浙大「代码作业」与「报告作业」登分值
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            isPending={syncingZju}
            onPress={syncZjuHomeworks}
          >
            {({ isPending }) => (
              <>
                {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:cloud-upload" width={14} />}
                {t("syncZju")}
              </>
            )}
          </Button>
          <Button variant="secondary" size="sm" onPress={exportZjuCsv}>
            <Icon icon="lucide:download" width={14} />
            {t("exportZjuCsv")}
          </Button>
        </div>
      </motion.div>

      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-line bg-elevated p-1">
          {expData?.experiments.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setExpId(e.id)}
              className={cn(
                "relative whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                expId === e.id ? "text-white" : "text-fg-muted hover:bg-sunken",
              )}
            >
              {expId === e.id && (
                <motion.span
                  layoutId="exp-tab"
                  className="absolute inset-0 rounded-lg bg-gradient-to-r from-brand-600 to-brand-700"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative">Lab {e.number}</span>
            </button>
          ))}
        </div>

        <div className="relative min-w-48 flex-1">
          <Icon
            icon="lucide:search"
            width={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tc("search")}
            className="tabular w-full rounded-xl border border-line bg-elevated py-2 pl-10 pr-3 text-sm outline-none transition-all focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
          />
        </div>

        <Button variant="secondary" size="sm" isPending={checkingPlagiarism} onPress={runPlagiarism}>
          {({ isPending }) => (
            <>
              {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:scan-search" width={14} />}
              {t("runPlagiarism")}
            </>
          )}
        </Button>
      </div>

      {/* table */}
      {isLoading || !data ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-elevated">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                <th className="px-4 py-3">{tc("search") === "Search" ? "Student" : "学生"}</th>
                <th className="px-2 py-3 text-center">{t("acceptanceScore")}</th>
                <th className="px-2 py-3 text-center">{t("codeScore")}</th>
                <th className="px-2 py-3 text-center">{t("reportScore")}</th>
                <th className="px-3 py-3 text-center bg-brand-500/5 text-brand-600 dark:text-brand-400">
                  <div className="flex flex-col items-center">
                    <span>{t("codeAssignmentScore")}</span>
                    <span className="text-[10px] font-normal opacity-80">({t("codeAssignmentHint")})</span>
                  </div>
                </th>
                <th className="px-3 py-3 text-center bg-purple-500/5 text-purple-600 dark:text-purple-400">
                  <div className="flex flex-col items-center">
                    <span>{t("reportAssignmentScore")}</span>
                    <span className="text-[10px] font-normal opacity-80">({t("reportAssignmentHint")})</span>
                  </div>
                </th>
                <th className="px-2 py-3 text-center">{t("penalty")}</th>
                <th className="px-3 py-3 text-center">{t("finalScore")}</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {filtered.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.015, 0.4) }}
                    className="border-b border-line/60 transition-colors last:border-0 hover:bg-sunken/50"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-semibold">{r.name}</div>
                          <div className="tabular text-xs text-fg-subtle">{r.studentId}</div>
                        </div>
                        {r.submission?.isPlagiarised && (
                          <Chip size="sm" color="danger" variant="soft">
                            <Icon icon="lucide:alert-triangle" width={11} />
                          </Chip>
                        )}
                        {r.submission?.checkpointClaimed && (
                          <Chip size="sm" color="accent" variant="soft">
                            CP
                          </Chip>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <ScoreCell
                        value={r.submission?.acceptanceScore ?? null}
                        onSave={(v) => saveScore(r.studentId, { acceptanceScore: v })}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <ScoreCell
                        value={r.submission?.codeScore ?? null}
                        onSave={(v) => saveScore(r.studentId, { codeScore: v })}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <ScoreCell
                        value={r.submission?.reportScore ?? null}
                        onSave={(v) => saveScore(r.studentId, { reportScore: v })}
                      />
                    </td>

                    {/* ZJU Code Assignment Calculated Score (Acceptance + Code) */}
                    <td className="px-3 py-2.5 text-center bg-brand-500/5">
                      {r.submission?.codeAssignmentScore !== null && r.submission?.codeAssignmentScore !== undefined ? (
                        <div className="flex flex-col items-center">
                          <span className="tabular font-bold text-brand-600 dark:text-brand-300">
                            {r.submission.codeAssignmentScore.toFixed(1)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-fg-subtle text-xs">—</span>
                      )}
                    </td>

                    {/* ZJU Report Assignment Calculated Score (Report) */}
                    <td className="px-3 py-2.5 text-center bg-purple-500/5">
                      {r.submission?.reportAssignmentScore !== null && r.submission?.reportAssignmentScore !== undefined ? (
                        <div className="flex flex-col items-center">
                          <span className="tabular font-bold text-purple-600 dark:text-purple-300">
                            {r.submission.reportAssignmentScore.toFixed(1)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-fg-subtle text-xs">—</span>
                      )}
                    </td>

                    <td className="px-2 py-2.5 text-center">
                      <ScoreCell
                        value={r.submission ? r.submission.reportPenalty + r.submission.codePenalty : null}
                        onSave={(v) => saveScore(r.studentId, { reportPenalty: v ?? 0 })}
                        placeholder="0"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {r.submission?.finalScore !== null && r.submission?.finalScore !== undefined ? (
                        <AnimatedNumber
                          value={r.submission.finalScore}
                          format={(v) => (Math.round(v * 10) / 10).toFixed(1)}
                          className={cn(
                            "tabular font-bold",
                            r.submission.finalScore >= 80
                              ? "text-emerald-600 dark:text-emerald-400"
                              : r.submission.finalScore >= 60
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-red-500",
                          )}
                        />
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.submission?.remark && (
                        <span className="block max-w-32 truncate text-xs text-fg-subtle" title={r.submission.remark}>
                          {r.submission.remark}
                        </span>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
