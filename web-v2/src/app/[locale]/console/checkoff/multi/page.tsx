"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Button, Spinner } from "@heroui/react";
import { toast } from "sonner";
import {
  CheckoffContext,
  type CheckoffState,
  type Experiment,
  type MatchedStudent,
  type Step,
} from "@/components/checkoff/checkoff-store";
import { ExperimentPicker } from "@/components/checkoff/ExperimentPicker";
import { StudentFinder } from "@/components/checkoff/StudentFinder";
import { QuestionDrawer } from "@/components/checkoff/QuestionDrawer";
import { ScoreForm } from "@/components/checkoff/ScoreForm";
import { SlavePanel } from "@/components/checkoff/SlavePanel";
import { Icon } from "@/components/ui/Icon";
import { useMasterSession, type SlaveCardState } from "@/lib/use-checkoff-socket";
import { useSession } from "@/lib/use-session";

/**
 * Multi-device checkoff: this device is the master console driving a
 * read-only slave display at /checkin/[token].
 *
 * Master flow:  pick lab → (slave: idle "此处可验收 LabN")
 *               find student → (slave: ask "您的姓名/学号？")
 *               pick student & draw questions → (slave: name + question cards)
 *               score → (slave: thanks) → back to idle.
 */
export default function MultiCheckoffPage() {
  const t = useTranslations("checkoff");
  const { session } = useSession();

  const [step, setStep] = useState<Step>(0);
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [student, setStudent] = useState<MatchedStudent | null>(null);
  const [drawnQuestions, setDrawnQuestions] = useState<Experiment["questions"]>([]);
  const [questionMarks, setQuestionMarks] = useState<CheckoffState["questionMarks"]>({});
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);

  const master = useMasterSession(session?.id, true);
  const masterSnap = useSyncExternalStore(master.subscribe, master.getSnapshot, master.getServerSnapshot);

  const pushSlave = useCallback(
    (state: SlaveCardState, experimentId?: string | null) => {
      master.pushState(state, experimentId);
    },
    [master],
  );

  const syncIdle = useCallback(
    (exp: Experiment | null) => {
      pushSlave(
        exp
          ? { kind: "idle", experimentNumber: exp.number, experimentName: exp.name }
          : { kind: "idle", experimentNumber: "—", experimentName: "" },
        exp?.id ?? null,
      );
    },
    [pushSlave],
  );

  useEffect(() => {
    fetch("/api/checkoff")
      .then((r) => r.json())
      .then((data) => setExperiments(data.experiments ?? []));
  }, []);

  const selectExperiment = useCallback(
    (e: Experiment) => {
      setExperiment(e);
      setStudent(null);
      setDrawnQuestions([]);
      setQuestionMarks({});
      setQuestionIndex(0);
      setStep(1);
      syncIdle(e);
    },
    [syncIdle],
  );

  // Step 1→2: master opens the student finder → slave asks name/id (display only)
  useEffect(() => {
    if (step === 1 && experiment) syncIdle(experiment);
    if (step === 1 && experiment && !student) {
      // also surface the ask card so students know to state their name
      // (master still controls selection)
    }
  }, [step, experiment, student, syncIdle]);

  const selectStudent = useCallback(
    (s: MatchedStudent | null) => {
      if (!s) {
        setStudent(null);
        setStep(1);
        syncIdle(experiment);
        return;
      }
      setStudent(s);
      setDrawnQuestions([]);
      setQuestionMarks({});
      setQuestionIndex(0);
      if (experiment) {
        pushSlave({ kind: "ask", experimentNumber: experiment.number }, experiment.id);
        setStep(experiment.questions.length > 0 ? 2 : 3);
      } else {
        setStep(3);
      }
    },
    [experiment, pushSlave, syncIdle],
  );

  // Push question cards (with student name) as they are drawn / browsed
  useEffect(() => {
    if (!experiment || !student || drawnQuestions.length === 0) return;
    const q = drawnQuestions[Math.min(questionIndex, drawnQuestions.length - 1)];
    pushSlave(
      {
        kind: "question",
        studentName: student.name,
        index: questionIndex + 1,
        total: drawnQuestions.length,
        content: q.content,
      },
      experiment.id,
    );
  }, [drawnQuestions, questionIndex, experiment, student, pushSlave]);

  const markQuestion = useCallback((id: string, mark: "correct" | "partial" | "wrong") => {
    setQuestionMarks((prev) => ({ ...prev, [id]: prev[id] === mark ? undefined : mark }));
  }, []);

  // Questions done → master is on the score page; slave shows thanks while
  // the TA fills in the score.
  useEffect(() => {
    if (step === 3 && experiment) {
      pushSlave({ kind: "thanks", studentName: student?.name }, experiment.id);
    }
  }, [step, experiment, student, pushSlave]);

  // Saved: reset back to the idle "此处可验收" card.
  const reset = useCallback(() => {
    setStudent(null);
    setDrawnQuestions([]);
    setQuestionMarks({});
    setQuestionIndex(0);
    setStep(1);
    syncIdle(experiment);
  }, [experiment, syncIdle]);

  const store = useMemo<CheckoffState>(
    () => ({
      step,
      setStep,
      experiment,
      selectExperiment,
      student,
      selectStudent,
      drawnQuestions,
      setDrawnQuestions,
      questionMarks,
      markQuestion,
      reset,
    }),
    [step, experiment, student, drawnQuestions, questionMarks, selectExperiment, selectStudent, markQuestion, reset],
  );

  if (!experiments) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <CheckoffContext.Provider value={store}>
      <div className="mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6"
        >
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Icon icon="lucide:monitor-smartphone" width={24} className="text-brand-500" />
            {t("title")} · 多设备
          </h1>
          {experiment && (
            <p className="tabular mt-1 text-sm text-fg-muted">
              Lab {experiment.number} · {experiment.name}
            </p>
          )}
        </motion.div>

        <div className="mb-4">
          {masterSnap.ready && masterSnap.code && masterSnap.token ? (
            <SlavePanel
              code={masterSnap.code}
              token={masterSnap.token}
              slaveConnected={masterSnap.slaveConnected}
            />
          ) : (
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-elevated px-5 py-4 text-sm text-fg-muted">
              <Spinner size="sm" />
              正在创建会话…
            </div>
          )}
        </div>

        {/* master step rail */}
        <div className="mb-6 flex gap-2">
          {([
            { s: 0 as Step, label: t("stepExperiment"), icon: "lucide:flask-conical" },
            { s: 1 as Step, label: t("stepStudent"), icon: "lucide:user-search" },
            { s: 2 as Step, label: t("stepQuestions"), icon: "lucide:help-circle" },
            { s: 3 as Step, label: t("stepScore"), icon: "lucide:pen-line" },
          ]).map((item) => (
            <Button
              key={item.s}
              size="sm"
              variant={step === item.s ? "primary" : "ghost"}
              isDisabled={
                (item.s === 1 && !experiment) ||
                (item.s >= 2 && (!experiment || !student))
              }
              onPress={() => setStep(item.s)}
            >
              <Icon icon={item.icon} width={13} />
              {item.label}
            </Button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === 0 && <ExperimentPicker experiments={experiments} onSelect={selectExperiment} />}
            {step === 1 && experiment && (
              <StudentFinder experiment={experiment} onSelect={selectStudent} />
            )}
            {step === 2 && (
              <QuestionDrawer
                onNext={() => setStep(3)}
                questionIndex={questionIndex}
                onQuestionIndex={setQuestionIndex}
              />
            )}
            {step === 3 && <ScoreForm onSaved={reset} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </CheckoffContext.Provider>
  );
}
