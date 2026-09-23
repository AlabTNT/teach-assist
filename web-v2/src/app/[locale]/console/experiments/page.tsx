"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Button, Chip, Skeleton, Spinner } from "@heroui/react";
import useSWR from "swr";
import { toast } from "sonner";
import { fetcher } from "@/lib/api-hooks";
import { Icon } from "@/components/ui/Icon";

type Experiment = {
  id: string;
  number: string;
  name: string;
  publishDate: string;
  dueDate: string;
  isPublished: boolean;
  totalScore: number;
  courseWeight: number;
  acceptanceRatio: number;
  reportRatio: number;
  codeRatio: number;
  type: string;
  questions: { id: string; content: string }[];
  _count: { submissions: number };
};

const inputClass =
  "w-full rounded-xl border border-line bg-elevated px-3.5 py-2.5 text-sm outline-none transition-all focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15";

function CreateExperimentForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("experiments");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    number: "",
    name: "",
    publishDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    totalScore: "100",
    courseWeight: "3.75",
    acceptanceRatio: "0.5",
    reportRatio: "0.2",
    codeRatio: "0.3",
    type: "HARDWARE",
  });
  const [questions, setQuestions] = useState<string[]>([]);
  const [qInput, setQInput] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, questions }),
      });
      if (!res.ok) throw new Error();
      toast.success(tc("success"));
      onDone();
    } catch {
      toast.error(tc("error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onSubmit={submit}
      className="rounded-2xl border border-line bg-elevated p-6"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">{t("experimentNumber")}</label>
          <input className={inputClass + " tabular"} value={form.number} onChange={set("number")} required />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">{t("experimentName")}</label>
          <input className={inputClass} value={form.name} onChange={set("name")} required />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">{t("publishDate")}</label>
          <input type="date" className={inputClass + " tabular"} value={form.publishDate} onChange={set("publishDate")} required />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">{t("dueDate")}</label>
          <input type="date" className={inputClass + " tabular"} value={form.dueDate} onChange={set("dueDate")} required />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">{t("courseWeight")}</label>
          <input className={inputClass + " tabular"} value={form.courseWeight} onChange={set("courseWeight")} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-fg-muted">{t("type")}</label>
          <select className={inputClass} value={form.type} onChange={set("type")}>
            <option value="HARDWARE">{t("typeHardware")}</option>
            <option value="SOFTWARE">{t("typeSoftware")}</option>
            <option value="INTEGRATED">{t("typeIntegrated")}</option>
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:col-span-2">
          {(["acceptanceRatio", "reportRatio", "codeRatio"] as const).map((k) => (
            <div key={k}>
              <label className="mb-1.5 block text-xs font-semibold text-fg-muted">{t(k)}</label>
              <input className={inputClass + " tabular"} value={form[k]} onChange={set(k)} />
            </div>
          ))}
        </div>
      </div>

      {/* question bank */}
      <div className="mt-5 border-t border-line pt-4">
        <label className="mb-2 block text-xs font-semibold text-fg-muted">{t("questions")}</label>
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder={t("addQuestion")}
          />
          <Button
            variant="secondary"
            onPress={() => {
              if (qInput.trim()) {
                setQuestions((q) => [...q, qInput.trim()]);
                setQInput("");
              }
            }}
          >
            <Icon icon="lucide:plus" width={16} />
          </Button>
        </div>
        <AnimatePresence>
          {questions.map((q, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="mt-2 flex items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-sm"
            >
              <span className="tabular text-xs text-fg-subtle">{i + 1}.</span>
              <span className="flex-1">{q}</span>
              <button
                type="button"
                onClick={() => setQuestions((prev) => prev.filter((_, j) => j !== i))}
                className="text-fg-subtle hover:text-danger"
              >
                <Icon icon="lucide:x" width={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Button type="submit" fullWidth size="lg" isPending={saving} className="mt-6 bg-gradient-to-r from-brand-600 to-brand-700">
        {({ isPending }) => (
          <>
            {isPending ? <Spinner color="current" size="sm" /> : <Icon icon="lucide:check" width={16} />}
            {tc("create")}
          </>
        )}
      </Button>
    </motion.form>
  );
}

export default function ExperimentsPage() {
  const t = useTranslations("experiments");
  const tc = useTranslations("common");
  const { data, isLoading, mutate } = useSWR<{ experiments: Experiment[] }>("/api/experiments", fetcher);
  const [creating, setCreating] = useState(false);

  const [syncingId, setSyncingId] = useState<string | null>(null);

  const togglePublish = async (exp: Experiment) => {
    try {
      const willPublish = !exp.isPublished;
      const res = await fetch("/api/experiments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: exp.id, isPublished: willPublish, syncZju: willPublish }),
      });
      const data = await res.json();
      if (res.ok) {
        if (willPublish) {
          if (data.syncResult?.success) {
            toast.success("已发布，并已在学在浙大同步创建代码与报告作业！");
          } else if (data.syncResult?.skipped) {
            toast.info("已在本地发布（未配置学在浙大助教凭据，跳过在线建作业）");
          } else if (data.syncResult?.error) {
            toast.warning(`已在本地发布，但学在浙大同步未完成: ${data.syncResult.message || data.syncResult.error}`);
          } else {
            toast.success(t("publish"));
          }
        } else {
          toast.success(t("unpublish"));
        }
        mutate();
      } else {
        toast.error(tc("error"));
      }
    } catch {
      toast.error(tc("error"));
    }
  };

  const manualSyncZju = async (exp: Experiment) => {
    setSyncingId(exp.id);
    try {
      const res = await fetch("/api/experiments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: exp.id, isPublished: true, syncZju: true }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.syncResult?.success) {
          toast.success("学在浙大作业已同步创建成功！");
        } else if (data.syncResult?.skipped) {
          toast.info("未配置学在浙大助教账号凭据，请先在设置页保存学在浙大账号");
        } else {
          toast.error(`同步失败: ${data.syncResult?.message || data.syncResult?.error || tc("error")}`);
        }
        mutate();
      } else {
        toast.error(tc("error"));
      }
    } catch {
      toast.error(tc("error"));
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mb-6 flex items-end justify-between"
      >
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t("title")}</h1>
        <Button size="lg" onPress={() => setCreating((v) => !v)} variant={creating ? "ghost" : "primary"}>
          <Icon icon={creating ? "lucide:x" : "lucide:plus"} width={16} />
          {t("newExperiment")}
        </Button>
      </motion.div>

      <AnimatePresence mode="wait">
        {creating && (
          <div className="mb-6">
            <CreateExperimentForm
              onDone={() => {
                setCreating(false);
                mutate();
              }}
            />
          </div>
        )}
      </AnimatePresence>

      {isLoading || !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {data.experiments.map((exp, i) => (
            <motion.div
              key={exp.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-elevated p-5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/15 to-amber-500/10">
                <span className="tabular text-lg font-bold text-brand-600 dark:text-brand-300">{exp.number}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold">{exp.name}</h3>
                  <Chip size="sm" color={exp.isPublished ? "success" : "default"} variant="soft">
                    {exp.isPublished ? t("published") : t("unpublished")}
                  </Chip>
                </div>
                <div className="tabular mt-1 text-xs text-fg-muted">
                  {new Date(exp.dueDate).toLocaleDateString()} · {t("courseWeight")} {exp.courseWeight} ·{" "}
                  {exp.questions.length} {t("questions")} · {exp._count.submissions} subs
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  isPending={syncingId === exp.id}
                  onPress={() => manualSyncZju(exp)}
                >
                  {({ isPending }) => (
                    <>
                      {isPending ? <Spinner size="sm" color="current" /> : <Icon icon="lucide:cloud-upload" width={14} />}
                      同步学在浙大
                    </>
                  )}
                </Button>
                <Button
                  variant={exp.isPublished ? "danger-soft" : "primary"}
                  size="sm"
                  onPress={() => togglePublish(exp)}
                >
                  <Icon icon={exp.isPublished ? "lucide:eye-off" : "lucide:eye"} width={14} />
                  {exp.isPublished ? t("unpublish") : t("publish")}
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
