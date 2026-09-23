import { zjuClient } from './zjuam';

// Active 2026 TA Course for Computer Systems II
export const TARGET_COURSE_ID = '100199'; 
// Explicitly ignored courses (e.g. 2025 student course where user was a student)
export const IGNORED_COURSE_IDS = ['87493'];

export interface ZJUCourseItem {
  id: number | string;
  name: string;
  course_code: string;
  start_date: string;
  end_date: string | null;
  is_instructor: boolean;
  created_user?: { id: number; name: string };
  instructors?: Array<{ id: number; name: string; email: string }>;
}

export class ZJUCourses {
  constructor(private cookies: string) {}

  /**
   * Fetch all courses and strictly filter for 2026 TA courses.
   * Explicitly ignores 2025 courses and any course where role is STUDENT.
   */
  public async getTACourses(): Promise<ZJUCourseItem[]> {
    const allCourses = await this.getAllMyCourses();
    
    return allCourses.filter(c => {
      const idStr = String(c.id);
      // Strictly ignore 2025 student courses
      if (IGNORED_COURSE_IDS.includes(idStr)) {
        return false;
      }
      
      // Must be instructor / TA
      if (!c.is_instructor) {
        return false;
      }

      // Must be 2026 academic year
      const is2026 = 
        (c.course_code && c.course_code.includes('2026-2027')) ||
        (c.start_date && c.start_date.startsWith('2026'));

      return is2026;
    });
  }

  public async getAllMyCourses(): Promise<ZJUCourseItem[]> {
    const MY_COURSES_BODY = {
      "fields": "id,name,course_code,department(id,name),grade(id,name),klass(id,name),course_type,start_date,end_date,is_started,is_closed,credit,compulsory,second_name,display_name,created_user(id,name),is_instructor,is_team_teaching,instructors(id,name,email)",
      "page": 1, "page_size": 1000,
      "conditions": {"status": ["ongoing", "notStarted", "closed"], "keyword": "", "classify_type": "recently_started", "display_studio_list": false},
      "showScorePassedStatus": false,
    };

    const res = await zjuClient.post('https://courses.zju.edu.cn/api/my-courses', MY_COURSES_BODY, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies
      }
    });

    return res.data?.courses || [];
  }

  /**
   * Get activities for the 2026 TA course (100199).
   */
  public async getCourseActivities(courseId = TARGET_COURSE_ID) {
    if (IGNORED_COURSE_IDS.includes(String(courseId))) {
      throw new Error(`Course ${courseId} is a student course and is ignored.`);
    }
    const url = `https://courses.zju.edu.cn/api/courses/${courseId}/activities?fields=id,title,type,status&page=1&page_size=100`;
    const res = await zjuClient.get(url, {
      headers: { 'Cookie': this.cookies }
    });
    return res.data;
  }

  /**
   * Get homework activities for the 2026 TA course (100199).
   */
  public async getHomeworkActivities(courseId = TARGET_COURSE_ID) {
    if (IGNORED_COURSE_IDS.includes(String(courseId))) {
      throw new Error(`Course ${courseId} is a student course and is ignored.`);
    }
    const url = `https://courses.zju.edu.cn/api/courses/${courseId}/homework-activities?fields=id,title,start_time,end_time,status`;
    const res = await zjuClient.get(url, {
      headers: { 'Cookie': this.cookies }
    });
    return res.data;
  }

  /**
   * Create a single homework activity on courses.zju.edu.cn
   */
  public async createHomeworkActivity(courseId: string, params: {
    title: string;
    description: string;
    endTime: string;
    moduleId?: number;
    publish?: boolean;
  }) {
    const moduleId = params.moduleId || 761987;
    const payload = {
      course_id: Number(courseId),
      title: params.title,
      type: "homework",
      module_id: moduleId,
      end_time: params.endTime,
      description: params.description,
      published: Boolean(params.publish),
      completion_criterion: { value: 0 },
      announce_answer_status: "no_announce",
      announce_score_type: 1,
      score_percentage: 0,
      score_rule: "highest",
      submit_times: 1,
      non_submit_times: true,
      review_by_instructor: true,
      review_by_inter: false,
      review_by_interGroup: false,
      review_by_intraGroup: false,
      rubric_id: 0,
      intra_rubric_id: 0,
      rubric_instance_id: 0,
      intra_rubric_instance_id: 0,
      score_item_group_id: 0,
      homework_type: "file_upload",
      allow_retract: true,
      mode: "normal",
      reference_answer: "",
      uploads: [],
      assign_group_ids: [],
      assign_student_ids: [],
      is_assigned_to_all: true,
      group_set_id: 0,
      submit_by_group: false,
      start_time: null,
      visible_start_at: null,
      visible_end_at: null,
      syllabus_id: 0,
      teaching_model: "online",
      using_phase: "unspecified",
    };

    const res = await zjuClient.post(
      `https://courses.zju.edu.cn/api/courses/${courseId}/activities`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': this.cookies
        }
      }
    );

    const activity = res.data;
    if (params.publish && !activity.published) {
      try {
        await zjuClient.put(
          `https://courses.zju.edu.cn/api/activities/${activity.id}`,
          { ...payload, id: activity.id, published: true },
          {
            headers: {
              'Content-Type': 'application/json',
              'Cookie': this.cookies
            }
          }
        );
      } catch (err: any) {
        console.warn('PUT activity published warning:', err.message);
      }
    }

    return activity;
  }

  /**
   * Automatically publish TWO homeworks for an experiment:
   * 1. Code submission
   * 2. Report submission
   */
  public async createExperimentDualHomeworks(courseId = TARGET_COURSE_ID, experiment: {
    number: string;
    name: string;
    dueDate: Date | string;
    acceptanceRatio?: number;
    reportRatio?: number;
    codeRatio?: number;
  }, publish = false) {
    const endIso = new Date(experiment.dueDate).toISOString();
    const labTag = experiment.number;

    const accPct = Math.round((experiment.acceptanceRatio ?? 0.5) * 100);
    const codePct = Math.round((experiment.codeRatio ?? 0.3) * 100);
    const repPct = Math.round((experiment.reportRatio ?? 0.2) * 100);

    // 1. Code homework (验收 + 代码折算)
    const codeTitle = `${labTag} 实验代码提交`;
    const codeDesc = `<p>请同学们提交 <strong>${experiment.name}</strong> 的代码工程压缩包。<br/>` +
      `命名格式为：<strong>学号_${labTag.toLowerCase()}.zip</strong>。<br/>` +
      `📊 <strong>成绩构成说明</strong>：本次代码作业成绩由<strong>现场验收（${accPct}%）</strong>与<strong>代码评分（${codePct}%）</strong>加权综合折算登录。<br/>` +
      `⚠️ 申领了 Checkpoint 的同学请勿提交本次作业，依据课程规定记 0 分。</p>`;

    const codeActivity = await this.createHomeworkActivity(courseId, {
      title: codeTitle,
      description: codeDesc,
      endTime: endIso,
      publish
    });

    // 2. Report homework (报告折算)
    const reportTitle = `${labTag} 实验报告提交`;
    const reportDesc = `<p>请同学们提交 <strong>${experiment.name}</strong> 的实验报告。<br/>` +
      `以 PDF 格式提交，命名格式为：<strong>学号_${labTag.toLowerCase()}.pdf</strong>。<br/>` +
      `📊 <strong>成绩构成说明</strong>：本次报告作业成绩由<strong>实验报告评分（${repPct}%）</strong>折算登录。<br/>` +
      `⚠️ 申领了 Checkpoint 的同学请勿提交本次作业，依据课程规定记 0 分。</p>`;

    const reportActivity = await this.createHomeworkActivity(courseId, {
      title: reportTitle,
      description: reportDesc,
      endTime: endIso,
      publish
    });

    return {
      codeActivity,
      reportActivity
    };
  }
}
